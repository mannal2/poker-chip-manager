import type { GameSettings } from '../../../game/settings';
import type { GameEvent } from '../../../game/types';
import type { ControlLease, ControlRecord, DispatchResult, Request, StoredGame } from './types';
import { createTournament, transition } from '../../../game/transition';
import { openDatabase, type PokerDB } from './database';
import { validateStored } from './restore';
import { storageDeadline } from './storageDeadline';
import { recordStorageError } from './errorLog';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
// IndexedDB 트랜잭션 모드
type StoreMode = 'readonly' | 'readwrite';
// 게임 슬롯/이벤트/조작권을 함께 다루는 트랜잭션 형식
type Tx<M extends StoreMode = 'readwrite'> = IDBPTransaction<
  PokerDB,
  ('slot' | 'events' | 'control')[],
  M
>;
// 게임, 이벤트, 조작권을 IndexedDB에 저장하고 읽는 저장소
export class LocalRepository {
  private db: Promise<IDBPDatabase<PokerDB>> | null = null;
  private invalid = false;
  private disposed = false;
  private operations = new Set<() => void>();
  constructor(
    private name = 'poker-chip-manager',
    private onBlocked: () => void = () => {},
    private onInvalidated: () => void = () => {},
  ) {}
  // 데이터베이스 연결을 만들거나 기존 연결을 돌려준다
  private connect() {
    if (this.invalid || this.disposed)
      throw Error('저장에 문제가 생겼습니다. 앱을 다시 열어 주세요.');
    if (!this.db) {
      let expired = false;
      const raw = openDatabase(this.name, this.onBlocked, () => {
        if (this.db !== connection) return;
        this.invalid = true;
        this.onInvalidated();
      });
      const connection = storageDeadline(raw, '연결', () => {
        expired = true;
      });
      this.db = connection;
      void raw.then(
        (db) => {
          if (expired || this.db !== connection) db.close();
        },
        () => {},
      );
      void connection.catch(() => {
        if (this.db === connection) this.db = null;
      });
    }
    return this.db;
  }
  // 데이터베이스 연결을 닫고 연결 무효 상태를 해제해 다음 작업에서 다시 연결할 수 있게 한다
  reconnect() {
    this.close();
    this.invalid = false;
  }
  // 저장된 게임을 읽어 형식과 이벤트 개수를 검증한다
  private async checked(tx: Tx<StoreMode>): Promise<StoredGame | null> {
    const v = await tx.objectStore('slot').get('current');
    if (!v) return null;
    validateStored(v);
    const count = await tx
      .objectStore('events')
      .count(
        IDBKeyRange.bound(
          [v.state.tournamentId, 0],
          [v.state.tournamentId, Number.MAX_SAFE_INTEGER],
        ),
      );
    if (count !== v.eventSequence) throw Error('저장 기록 경계가 손상되었습니다.');
    return v;
  }
  // 트랜잭션 작업에 시간 제한과 취소 처리를 적용하고, 실패하면 오류를 기록한다
  private async transaction<T, M extends StoreMode>(
    phase: string,
    mode: M,
    action: (tx: Tx<M>) => Promise<T>,
  ): Promise<T> {
    let tx: Tx<M> | undefined;
    let cancelled = false;
    const abort = () => {
      try {
        tx?.abort();
      } catch {
        /* already complete */
      }
    };
    let cancel!: () => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        if (cancelled) return;
        cancelled = true;
        abort();
        reject(new Error('저장에 문제가 생겼습니다. 앱을 다시 열어 주세요.'));
      };
    });
    this.operations.add(cancel);
    const work = (async () => {
      const db = await this.connect();
      if (cancelled) throw Error('저장 작업이 취소되었습니다.');
      tx = db.transaction(['slot', 'events', 'control'], mode);
      // Consume abort errors even if request completion never reaches the awaiting action.
      void tx.done.catch(() => {});
      return action(tx);
    })();
    try {
      return await storageDeadline(Promise.race([work, cancellation]), phase, () => this.close());
    } catch (error) {
      abort();
      recordStorageError(phase, error);
      // Cleanup must never wait for the same missing completion/abort notification.
      throw error;
    } finally {
      this.operations.delete(cancel);
    }
  }
  // 저장된 게임을 읽기 전용으로 불러온다
  async load(): Promise<StoredGame | null> {
    // Read-only so a device that refuses writes (low storage) can still show the saved game.
    return this.transaction('게임 읽기', 'readonly', async (tx) => {
      const saved = await this.checked(tx);
      await tx.done;
      return saved;
    });
  }
  // 저장된 게임과 기록을 지우고 새 토너먼트와 조작권을 만든다
  // Explicit recovery only: replace unreadable state atomically after user confirmation.
  async restart(settings: GameSettings, screenId: string) {
    return this.transaction('새 토너먼트 저장', 'readwrite', async (tx) => {
      const old = await tx.objectStore('control').get('owner');
      const generation = Number.isSafeInteger(old?.generation) ? old!.generation + 1 : 1;
      const lease = { screenId, generation };
      const state = createTournament(settings, {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
      });
      await tx
        .objectStore('slot')
        .put({ schemaVersion: 1, rulesVersion: 1, state, eventSequence: 0 }, 'current');
      await tx.objectStore('events').clear();
      await tx.objectStore('control').put({ ...lease, highWatermark: 0, results: [] }, 'owner');
      await tx.done;
      return { lease, state };
    });
  }
  // 조작권 세대를 올려 이 화면이 조작권을 얻게 한다
  async takeControl(screenId: string): Promise<ControlLease> {
    return this.transaction('조작권 저장', 'readwrite', async (tx) => {
      await this.checked(tx);
      const old = await tx.objectStore('control').get('owner');
      const control: ControlRecord = {
        screenId,
        generation: (old?.generation ?? 0) + 1,
        highWatermark: 0,
        results: [],
      };
      await tx.objectStore('control').put(control, 'owner');
      await tx.done;
      return { screenId, generation: control.generation };
    });
  }
  // 조작권을 확인한 뒤 저장된 게임이 없으면 새 토너먼트를 만든다
  async initialize(settings: GameSettings, lease: ControlLease): Promise<void> {
    return this.transaction('게임 초기화', 'readwrite', async (tx) => {
      const c = await tx.objectStore('control').get('owner');
      if (!c || c.screenId !== lease.screenId || c.generation !== lease.generation)
        throw Error('CONTROL_LOST');
      if (!(await this.checked(tx))) {
        const state = createTournament(settings, {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
        });
        await tx
          .objectStore('slot')
          .put({ schemaVersion: 1, rulesVersion: 1, state, eventSequence: 0 }, 'current');
      }
      await tx.done;
    });
  }
  // 요청을 검증하고 규칙을 적용해 새 상태, 이벤트, 결과를 한 트랜잭션으로 저장한다
  async dispatch(r: Request): Promise<DispatchResult> {
    try {
      return await this.transaction('게임 저장', 'readwrite', async (tx) => {
        const stored = await this.checked(tx),
          c = await tx.objectStore('control').get('owner'),
          state = stored?.state ?? null;
        const rejected = (reason: string): DispatchResult => ({
          status: 'REJECTED',
          requestId: r.requestId,
          state,
          reason,
        });
        if (!c || c.screenId !== r.lease.screenId || c.generation !== r.lease.generation) {
          await tx.done;
          return rejected('CONTROL_LOST');
        }
        const fingerprint = JSON.stringify({
          command: r.command,
          expectedVersion: r.expectedVersion,
          tournamentId: r.tournamentId,
          handId: r.handId,
        });
        const old = c.results.find((x) => x.sequence === r.sequence || x.requestId === r.requestId);
        if (old) {
          await tx.done;
          return old.fingerprint === fingerprint &&
            old.sequence === r.sequence &&
            old.requestId === r.requestId
            ? { ...old.result, state }
            : rejected('REQUEST_CONFLICT');
        }
        if (r.sequence <= c.highWatermark) {
          await tx.done;
          return rejected('RESULT_EXPIRED');
        }
        if (r.sequence !== c.highWatermark + 1) {
          await tx.done;
          return rejected('SEQUENCE_GAP');
        }
        let result: DispatchResult;
        let next = state,
          events: GameEvent[] = [];
        if (!stored || !state) result = rejected('NO_GAME');
        else if (state.tournamentId !== r.tournamentId) result = rejected('TOURNAMENT_CHANGED');
        else if (
          state.version !== r.expectedVersion ||
          (r.handId !== undefined && r.handId !== state.hand?.id)
        )
          result = rejected('STALE_STATE');
        else {
          const context = { id: r.requestId, at: new Date().toISOString() };
          if (r.command.type === 'NEW_TOURNAMENT') {
            next = createTournament(r.command.settings, context);
            next.version = state.version + 1;
            await tx.objectStore('events').clear();
            events = [
              {
                id: r.requestId,
                at: context.at,
                tournamentId: next.tournamentId,
                hand: 0,
                type: 'NEW_TOURNAMENT',
                details: {},
              },
            ];
          } else {
            const t = transition(state, r.command, context);
            if (t.ok) {
              next = t.state;
              events = t.events.length
                ? t.events
                : [
                    {
                      id: r.requestId,
                      at: context.at,
                      tournamentId: state.tournamentId,
                      hand: state.hand?.number ?? 0,
                      type: r.command.type,
                      details: r.command,
                    },
                  ];
            } else result = rejected(t.errorCode);
          }
          if (next !== state)
            result = {
              status: 'APPLIED',
              requestId: r.requestId,
              state: next,
              resultVersion: next!.version,
            };
        }
        result ??= rejected('INVALID_ACTION');
        if (result.status === 'APPLIED') {
          let sequence = r.command.type === 'NEW_TOURNAMENT' ? 0 : stored!.eventSequence;
          for (const e of events) {
            e.sequence = ++sequence;
            await tx.objectStore('events').put(e, [next!.tournamentId, sequence]);
          }
          await tx
            .objectStore('slot')
            .put(
              { schemaVersion: 1, rulesVersion: 1, state: next!, eventSequence: sequence },
              'current',
            );
        }
        const { state: ignored, ...compact } = result;
        void ignored;
        c.highWatermark = r.sequence;
        c.results.push({
          sequence: r.sequence,
          requestId: r.requestId,
          fingerprint,
          result: compact,
        });
        c.results = c.results.slice(-64);
        await tx.objectStore('control').put(c, 'owner');
        await tx.done;
        return result;
      });
    } catch (e) {
      return {
        status: 'UNKNOWN',
        requestId: r.requestId,
        state: null,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
  // 지정한 순번 이후의 이벤트를 최대 100개까지 읽는다
  async readEvents(id: string, after: number, limit: number): Promise<GameEvent[]> {
    return this.transaction('기록 읽기', 'readonly', async (tx) => {
      const events: GameEvent[] = [];
      let cursor = await tx
        .objectStore('events')
        .openCursor(IDBKeyRange.bound([id, after + 1], [id, Number.MAX_SAFE_INTEGER]));
      while (cursor && events.length < Math.min(limit, 100)) {
        events.push(cursor.value);
        cursor = await cursor.continue();
      }
      await tx.done;
      return events;
    });
  }
  // 저장된 조작권 기록을 읽는다
  async control(): Promise<ControlRecord | undefined> {
    return this.transaction('조작권 읽기', 'readonly', async (tx) => {
      const owner = await tx.objectStore('control').get('owner');
      await tx.done;
      return owner;
    });
  }
  // 진행 중 작업을 취소하고 데이터베이스 연결을 닫는다
  close() {
    for (const cancel of this.operations) cancel();
    void this.db?.then(
      (db) => db.close(),
      () => {},
    );
    this.db = null;
  }
  // 저장소를 폐기 상태로 만들고 연결을 닫는다
  dispose() {
    this.disposed = true;
    this.close();
  }
}
