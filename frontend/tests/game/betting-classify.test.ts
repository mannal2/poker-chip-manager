import { it, expect } from 'vitest';
import { fixtureState, apply, ctx } from './helpers';
import { classifyDraft } from '../../src/game/draft';
import { transition, getLegalActions } from '../../src/game/transition';
import type { GameCommand, GameState } from '../../src/game/types';

const classify = (s: GameState, amount: number) =>
  classifyDraft(getLegalActions(s), amount, s.hand!.W);

it('콜·베팅·레이즈·올인 금액을 명령으로 분류한다', () => {
  const pre = fixtureState();
  expect(classify(pre, 10)).toEqual({ ok: true, command: { type: 'CALL' } });
  expect(classify(pre, 20)).toEqual({ ok: true, command: { type: 'RAISE', additional: 20 } });
  expect(classify(pre, 1000)).toEqual({ ok: true, command: { type: 'ALL_IN' } });
  const flop = apply(apply(apply(pre, { type: 'CALL' }), { type: 'CALL' }), { type: 'CHECK' });
  expect(classify(flop, 10)).toEqual({ ok: true, command: { type: 'BET', additional: 10 } });
});

it('콜 미달·최소 레이즈 미달·차례 아님을 코드로 거절한다', () => {
  const pre = fixtureState();
  expect(classify(pre, 0)).toEqual({ ok: false, code: 'BELOW_CALL' });
  expect(classify(pre, 5)).toEqual({ ok: false, code: 'BELOW_CALL' });
  expect(classify(pre, 15)).toEqual({ ok: false, code: 'MIN_RAISE' });
  const legal = { ...getLegalActions(pre), actor: null };
  expect(classifyDraft(legal, 10, 10)).toEqual({ ok: false, code: 'NOT_ACTOR' });
});

/** Fresh betting street with the given stacks, matching the shared betting fixtures' setup. */
function street(stacks: number[]) {
  const s = fixtureState(stacks.length);
  s.hand = {
    ...s.hand!,
    street: 1,
    W: 0,
    R: 100,
    bb: 100,
    actorId: 'p0',
    pending: s.players.map((p) => p.id),
  };
  s.players.forEach((p, i) => {
    p.stack = stacks[i];
    p.B = 0;
    p.H = 0;
    p.actedAt = null;
    p.reopenAt = 0;
  });
  s.pot = 0;
  s.initialTotal = stacks.reduce((n, v) => n + v, 0);
  return s;
}
const closed = () =>
  apply(
    apply(apply(street([1000, 150, 1000]), { type: 'BET', additional: 100 }), { type: 'ALL_IN' }),
    {
      type: 'CALL',
    },
  );

it('짧은 올인 뒤 재레이즈가 닫히면 콜만 허용한다 (B05)', () => {
  const s = closed();
  expect(getLegalActions(s)).toMatchObject({ callAdditional: 50, canRaise: false });
  expect(classify(s, 50)).toEqual({ ok: true, command: { type: 'CALL' } });
  expect(classify(s, 100)).toEqual({ ok: false, code: 'RAISE_CLOSED' });
  expect(classify(s, getLegalActions(s).maxAdditional)).toEqual({
    ok: false,
    code: 'RAISE_CLOSED',
  });
});

it('콜보다 적은 스택의 올인은 콜로 남는다', () => {
  const s = apply(street([1000, 60, 1000]), { type: 'BET', additional: 100 });
  expect(classify(s, 60)).toEqual({ ok: true, command: { type: 'CALL' } });
});

/** classifyDraft must agree with transition for every 5-chip amount. */
function agreesWithRules(s: GameState) {
  const legal = getLegalActions(s);
  for (let amount = 5; amount <= legal.maxAdditional; amount += 5) {
    const result = classifyDraft(legal, amount, s.hand!.W);
    if (result.ok) {
      const r = transition(s, result.command, ctx);
      expect(r.ok, `${amount} → ${result.command.type}`).toBe(true);
      if (r.ok && result.command.type !== 'CALL') {
        const actor = r.state.players.find((p) => p.id === legal.actor!.id)!;
        expect(actor.B - legal.actor!.B).toBe(amount);
      }
    } else {
      const commands: GameCommand[] = [
        { type: 'BET', additional: amount },
        { type: 'RAISE', additional: amount },
      ];
      if (amount === legal.maxAdditional) commands.push({ type: 'ALL_IN' });
      if (amount === legal.callAdditional) commands.push({ type: 'CALL' });
      for (const command of commands)
        expect(transition(s, command, ctx).ok, `${amount} ${command.type}`).toBe(false);
    }
  }
}

it('모든 칩 금액에서 분류 결과와 규칙 검증이 일치한다', () => {
  const pre = fixtureState();
  agreesWithRules(pre);
  agreesWithRules(apply(pre, { type: 'RAISE', additional: 40 }));
  agreesWithRules(apply(apply(apply(pre, { type: 'CALL' }), { type: 'CALL' }), { type: 'CHECK' }));
  agreesWithRules(closed());
  agreesWithRules(street([300, 150, 400]));
  agreesWithRules(apply(street([300, 150, 400]), { type: 'BET', additional: 100 }));
  agreesWithRules(apply(street([1000, 60, 1000]), { type: 'BET', additional: 100 }));
});
