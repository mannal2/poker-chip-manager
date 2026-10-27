import { it, expect } from 'vitest';
import { readAllEvents, type LoadEvents } from '../../src/features/gameplay/model/eventPages';
import type { GameEvent } from '../../src/game/types';

const events = (n: number): GameEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i + 1}`,
    at: '',
    tournamentId: 't',
    hand: 1,
    type: 'CHECK',
    details: {},
    sequence: i + 1,
  }));
/** In-memory source that records each page request. */
function source(all: GameEvent[]) {
  const calls: number[] = [];
  const load: LoadEvents = async (_id, after, limit) => {
    calls.push(after);
    return all.filter((e) => e.sequence! > after).slice(0, limit);
  };
  return { load, calls };
}

it('페이지 크기 경계에서 빠짐없이 시간순으로 모두 읽는다', async () => {
  for (const [n, pages] of [
    [0, [0]],
    [99, [0]],
    [100, [0, 100]],
    [101, [0, 100]],
    [250, [0, 100, 200]],
  ] as const) {
    const { load, calls } = source(events(n));
    const all = await readAllEvents(load, 't');
    expect(all!.map((e) => e.sequence)).toEqual(events(n).map((e) => e.sequence));
    expect(calls, `${n}개`).toEqual(pages);
  }
});

it('읽는 도중 화면이 닫히면 결과를 버리고 더 읽지 않는다', async () => {
  const { load, calls } = source(events(250));
  let active = true;
  const all = await readAllEvents(
    async (...args) => {
      const page = await load(...args);
      active = false;
      return page;
    },
    't',
    () => active,
  );
  expect(all).toBeNull();
  expect(calls).toEqual([0]);
});

it('읽기 실패는 호출자에게 그대로 전달한다', async () => {
  await expect(
    readAllEvents(async () => {
      throw Error('기록 읽기 실패');
    }, 't'),
  ).rejects.toThrow('기록 읽기 실패');
});
