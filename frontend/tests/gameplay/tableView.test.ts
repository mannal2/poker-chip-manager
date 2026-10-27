import { it, expect } from 'vitest';
import { buildTableView } from '../../src/features/gameplay/model/tableView';
import { createTournament } from '../../src/game/transition';
import { defaultSettings } from '../../src/game/settings';
import { fixtureState, ctx } from '../game/helpers';

const emptyDrafts = { draftAmount: 0, pots: [], potIndex: 0, winners: {} };

it('딜러 미선택 준비 화면에는 역할·행동자·승자 표시가 없다', () => {
  const state = createTournament(defaultSettings, ctx);
  const view = buildTableView(state, emptyDrafts);
  expect(view.players.map((p) => p.roles)).toEqual(['', '']);
  expect(view.players.map((p) => p.active)).toEqual([false, false]);
  expect(view.players.map((p) => p.selected)).toEqual([false, false]);
  expect(view.players.map((p) => p.eligible)).toEqual([undefined, undefined]);
  expect(view).toMatchObject({ pot: 0, phase: 'setup', street: 'PREFLOP' });
  expect(view.handKey).toBeUndefined();
  expect(view.notice).toBeUndefined();
  expect(view.potLabel).toBeUndefined();
});

it('2인 준비에서는 딜러가 SB를 겸하고 나머지가 BB다', () => {
  const state = createTournament({ ...defaultSettings, button: 1 }, ctx);
  expect(buildTableView(state, emptyDrafts).players.map((p) => p.roles)).toEqual(['BB', 'D · SB']);
});

it('다인 준비에서는 마지막 딜러 뒤로 SB·BB가 순환한다', () => {
  const state = createTournament(
    { ...defaultSettings, names: ['A', 'B', 'C', 'D'], button: 3 },
    ctx,
  );
  expect(buildTableView(state, emptyDrafts).players.map((p) => p.roles)).toEqual([
    'SB',
    'BB',
    '',
    'D',
  ]);
});

it('게임 중에는 설정 딜러·화면 회전보다 핸드의 저장된 역할 위치를 사용한다', () => {
  const state = fixtureState(3);
  state.settings.button = 2;
  const view = buildTableView(state, emptyDrafts);
  expect(view.players.map((p) => p.roles)).toEqual(['D', 'SB', 'BB']);
  expect(view.handKey).toBe('test:hand:1');
});

it('초안은 행동자의 누적액에만 더하며 원본 장부·잔액을 변경하지 않는다', () => {
  const state = fixtureState(3);
  const before = structuredClone(state);
  const view = buildTableView(state, { ...emptyDrafts, draftAmount: 25 });
  expect(view.players.map((p) => p.contribution)).toEqual([25, 5, 10]);
  expect(view.players.map((p) => p.pending)).toEqual([true, false, false]);
  expect(view.players.map((p) => p.active)).toEqual([true, false, false]);
  expect(view.players.map((p) => p.stack)).toEqual([1000, 995, 990]);
  expect(state).toEqual(before);
});

it('탈락·폴드·올인 역할을 구분하고 탈락한 SB의 빈자리 안내를 표시한다', () => {
  const state = fixtureState(4);
  state.players[0].folded = true;
  state.players[1].eliminated = true;
  state.players[1].stack = 0;
  state.players[2].stack = 0;
  const view = buildTableView(state, emptyDrafts);
  expect(view.players.map((p) => p.roles)).toEqual(['D · 폴드', '탈락', 'BB · 올인', '']);
  expect(view.players.map((p) => p.out)).toEqual([false, true, false, false]);
  expect(view.players[0].folded).toBe(true);
  expect(view.notice).toBe('SB 없음');
});

it('현재 팟의 금액·자격·선택과 메인/사이드 라벨을 표시한다', () => {
  const state = fixtureState(3);
  state.hand!.phase = 'settlement';
  state.hand!.actorId = null;
  const drafts = {
    draftAmount: 0,
    pots: [
      { id: 'pot0', amount: 90, eligible: ['p0', 'p1', 'p2'] },
      { id: 'pot1', amount: 40, eligible: ['p1', 'p2'] },
    ],
    potIndex: 1,
    winners: { pot0: ['p0'], pot1: ['p2'] },
  };
  const side = buildTableView(state, drafts);
  expect(side).toMatchObject({ pot: 40, potLabel: 'SIDE POT 1', phase: 'settlement' });
  expect(side.players.map((p) => p.selected)).toEqual([false, false, true]);
  expect(side.players.map((p) => p.eligible)).toEqual([false, true, true]);
  const main = buildTableView(state, { ...drafts, potIndex: 0 });
  expect(main).toMatchObject({ pot: 90, potLabel: 'MAIN POT' });
  expect(main.players.map((p) => p.selected)).toEqual([true, false, false]);
  const single = buildTableView(state, { ...drafts, pots: [drafts.pots[0]], potIndex: 0 });
  expect(single.pot).toBe(90);
  expect(single.potLabel).toBeUndefined();
});

it.each([
  [0, 'PREFLOP'],
  [1, 'FLOP'],
  [2, 'TURN'],
  [3, 'RIVER'],
] as const)('스트리트 %i의 표시 이름은 %s다', (street, label) => {
  const state = fixtureState(3);
  state.hand!.street = street;
  const view = buildTableView(state, emptyDrafts);
  expect(view.street).toBe(label);
  expect(view.phase).toBe('betting');
  expect(view.pot).toBe(15);
});
