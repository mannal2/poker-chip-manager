import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LocalRepository } from '../../src/features/local-game/storage/repository';
import { defaultSettings } from '../../src/game/settings';
import type { GameCommand } from '../../src/game/types';
let n = 0;
function repo() {
  return new LocalRepository(`test-${n++}`);
}
describe('원자 저장·세대·요청', () => {
  it('L02 동일 요청은 1회만 납부, 같은 ID 다른 내용 거절', async () => {
    const r = repo();
    const lease = await r.takeControl('a');
    await r.initialize({ ...defaultSettings, button: 0 }, lease);
    const s = (await r.load())!.state;
    const req = {
      requestId: 'start',
      sequence: 1,
      lease,
      expectedVersion: s.version,
      tournamentId: s.tournamentId,
      command: { type: 'START_TOURNAMENT' } as GameCommand,
    };
    const a = await r.dispatch(req);
    const b = await r.dispatch(req);
    expect(a.status).toBe('APPLIED');
    expect(b.state?.version).toBe(a.state?.version);
    expect(b.state?.pot).toBe(15);
    expect((await r.dispatch({ ...req, command: { type: 'ABORT' } })).reason).toBe(
      'REQUEST_CONFLICT',
    );
    r.close();
  });
  it('L03 저장 선행·인수 선행 모두 이전 세대 쓰기 거절', async () => {
    const r = repo(),
      a = await r.takeControl('a');
    await r.initialize({ ...defaultSettings, button: 0 }, a);
    let s = (await r.load())!.state;
    expect(
      (
        await r.dispatch({
          requestId: '1',
          sequence: 1,
          lease: a,
          expectedVersion: s.version,
          tournamentId: s.tournamentId,
          command: { type: 'START_TOURNAMENT' },
        })
      ).status,
    ).toBe('APPLIED');
    const b = await r.takeControl('b');
    s = (await r.load())!.state;
    expect(s.pot).toBe(15);
    expect(
      (
        await r.dispatch({
          requestId: 'late',
          sequence: 2,
          lease: a,
          expectedVersion: s.version,
          tournamentId: s.tournamentId,
          command: { type: 'CALL' },
        })
      ).reason,
    ).toBe('CONTROL_LOST');
    expect(
      (
        await r.dispatch({
          requestId: 'b',
          sequence: 1,
          lease: b,
          expectedVersion: s.version,
          tournamentId: s.tournamentId,
          command: { type: 'CALL' },
        })
      ).status,
    ).toBe('APPLIED');
    r.close();
  });
  it('X01 65개 요청 이후 오래된 순번 재실행 금지', async () => {
    const r = repo(),
      lease = await r.takeControl('a');
    await r.initialize({ ...defaultSettings, button: 0 }, lease);
    let s = (await r.load())!.state;
    const first = {
      requestId: '1',
      sequence: 1,
      lease,
      expectedVersion: s.version,
      tournamentId: s.tournamentId,
      command: { type: 'SET_VIEW', viewSeat: 0 } as GameCommand,
    };
    await r.dispatch(first);
    for (let i = 2; i <= 65; i++) {
      s = (await r.load())!.state;
      await r.dispatch({ ...first, requestId: String(i), sequence: i, expectedVersion: s.version });
    }
    expect((await r.dispatch(first)).reason).toBe('RESULT_EXPIRED');
    expect((await r.load())!.state.version).toBe(65);
    r.close();
  });
  it('거절 명령도 순번 소진, 미래 순번 거절', async () => {
    const r = repo(),
      lease = await r.takeControl('a');
    await r.initialize({ ...defaultSettings, button: 0 }, lease);
    const s = (await r.load())!.state;
    const req = {
      requestId: 'a',
      sequence: 1,
      lease,
      expectedVersion: 0,
      tournamentId: s.tournamentId,
      command: { type: 'CALL' } as GameCommand,
    };
    expect((await r.dispatch(req)).status).toBe('REJECTED');
    expect((await r.dispatch({ ...req, sequence: 3, requestId: 'gap' })).reason).toBe(
      'SEQUENCE_GAP',
    );
    expect(
      (
        await r.dispatch({
          ...req,
          sequence: 2,
          requestId: 'start',
          command: { type: 'START_TOURNAMENT' },
        })
      ).status,
    ).toBe('APPLIED');
    r.close();
  });
  it('L01 기록 저장 실패이면 상태·기록 모두 이전 값', async () => {
    const r = repo(),
      lease = await r.takeControl('a');
    await r.initialize({ ...defaultSettings, button: 0 }, lease);
    const before = await r.load(),
      original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'events') throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
    try {
      expect(
        (
          await r.dispatch({
            requestId: 'x',
            sequence: 1,
            lease,
            expectedVersion: 0,
            tournamentId: before!.state.tournamentId,
            command: { type: 'START_TOURNAMENT' },
          })
        ).status,
      ).toBe('UNKNOWN');
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    expect(await r.load()).toEqual(before);
    expect(await r.readEvents(before!.state.tournamentId, 0, 100)).toHaveLength(0);
    r.close();
  });
});
it('최신 규칙과 다른 형식·손상 장부는 쓰기 전에 거절한다', async () => {
  const { validateStored } = await import('../../src/features/local-game/storage/restore');
  const { fixtureState } = await import('../game/helpers');
  const state = fixtureState();
  for (const saved of [
    { schemaVersion: 2, rulesVersion: 1, state, eventSequence: 0 },
    { schemaVersion: 1, rulesVersion: 2, state, eventSequence: 0 },
    { schemaVersion: 1, rulesVersion: 1, state: { ...state, pot: 20 }, eventSequence: 0 },
  ])
    expect(() => validateStored(saved)).toThrow();
});

it('자동 다음 핸드 저장·연결 재개 후 1회 무르기와 기록을 원자적으로 복원', async () => {
  const name = `undo-reload-${n++}`;
  let r = new LocalRepository(name);
  let lease = await r.takeControl('a');
  await r.initialize({ ...defaultSettings, button: 0 }, lease);
  let sequence = 0;
  async function send(command: GameCommand) {
    const state = (await r.load())!.state;
    const result = await r.dispatch({
      requestId: `undo-${++sequence}`,
      sequence,
      lease,
      expectedVersion: state.version,
      tournamentId: state.tournamentId,
      command,
    });
    expect(result.status).toBe('APPLIED');
    return result.state!;
  }
  const before = await send({ type: 'START_TOURNAMENT' });
  await send({ type: 'FOLD' });
  r.close();
  r = new LocalRepository(name);
  lease = await r.takeControl('b');
  sequence = 0;
  expect((await r.load())!.state.hand?.number).toBe(2);
  const result = await send({ type: 'UNDO' });
  expect(result).toEqual({ ...before, version: result.version, undo: null });
  expect((await r.load())!.state.undo).toBeNull();
  r.close();
});
