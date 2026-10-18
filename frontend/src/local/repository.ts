import type { GameSettings } from '../game/settings';
import type { GameState, GameCommand, GameEvent } from '../game/types';
import { createTournament, transition } from '../game/transition';
import { openDatabase, type PokerDB } from './database';
import { validateStored } from './restore';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
export interface ControlLease {
  screenId: string;
  generation: number;
}
export interface StoredGame {
  schemaVersion: number;
  rulesVersion: number;
  state: GameState;
  eventSequence: number;
}
export interface Request {
  requestId: string;
  sequence: number;
  lease: ControlLease;
  expectedVersion: number;
  tournamentId: string;
  handId?: string;
  command: GameCommand | { type: 'NEW_TOURNAMENT'; settings: GameSettings };
}
export interface DispatchResult {
  status: 'APPLIED' | 'REJECTED' | 'UNKNOWN';
  requestId: string;
  state: GameState | null;
  reason?: string;
  resultVersion?: number;
}
export interface ControlRecord extends ControlLease {
  highWatermark: number;
  results: Array<{
    sequence: number;
    requestId: string;
    fingerprint: string;
    result: Omit<DispatchResult, 'state'>;
  }>;
}
type Tx = IDBPTransaction<PokerDB, ('slot' | 'events' | 'control')[], 'readwrite'>;
export class LocalRepository {
  private db: Promise<IDBPDatabase<PokerDB>> | null = null;
  private invalid = false;
  constructor(
    private name = 'poker-chip-manager',
    private onBlocked: () => void = () => {},
    private onInvalidated: () => void = () => {},
  ) {}
  private connect() {
    if (this.invalid) throw Error('저장 연결이 변경되었습니다. 앱을 다시 열어주세요.');
    return (this.db ??= openDatabase(this.name, this.onBlocked, () => {
      this.invalid = true;
      this.onInvalidated();
    }));
  }
  private async checked(tx: Tx): Promise<StoredGame | null> {
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
  async load(): Promise<StoredGame | null> {
    const db = await this.connect(),
      tx = db.transaction(['slot', 'events', 'control'], 'readwrite');
    try {
      const s = await this.checked(tx);
      await tx.done;
      return s;
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* completed */
      }
      await tx.done.catch(() => {});
      throw e;
    }
  }
  async takeControl(screenId: string): Promise<ControlLease> {
    const db = await this.connect(),
      tx = db.transaction(['slot', 'events', 'control'], 'readwrite');
    try {
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
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* completed */
      }
      await tx.done.catch(() => {});
      throw e;
    }
  }
  async initialize(settings: GameSettings, lease: ControlLease): Promise<void> {
    const db = await this.connect(),
      tx = db.transaction(['slot', 'events', 'control'], 'readwrite');
    try {
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
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* completed */
      }
      await tx.done.catch(() => {});
      throw e;
    }
  }
  async dispatch(r: Request): Promise<DispatchResult> {
    let tx: Tx | undefined;
    try {
      const db = await this.connect();
      tx = db.transaction(['slot', 'events', 'control'], 'readwrite');
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
    } catch (e) {
      if (tx) {
        try {
          tx.abort();
        } catch {
          /* completed */
        }
        await tx.done.catch(() => {});
      }
      return {
        status: 'UNKNOWN',
        requestId: r.requestId,
        state: null,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
  async readEvents(id: string, after: number, limit: number): Promise<GameEvent[]> {
    const db = await this.connect(),
      tx = db.transaction('events'),
      events: GameEvent[] = [];
    let cursor = await tx.store.openCursor(
      IDBKeyRange.bound([id, after + 1], [id, Number.MAX_SAFE_INTEGER]),
    );
    while (cursor && events.length < Math.min(limit, 100)) {
      events.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return events;
  }
  async control(): Promise<ControlRecord | undefined> {
    return (await this.connect()).get('control', 'owner');
  }
  close() {
    void this.db?.then((db) => db.close());
    this.db = null;
  }
}
