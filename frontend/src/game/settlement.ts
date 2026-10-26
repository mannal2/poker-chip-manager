import type { SettlementErrorCode } from './errors';
import type { GameState, Pot, WinnerSelection } from './types';
export function buildPots(s: GameState): Pot[] {
  const heights = [...new Set(s.players.map((p) => p.H).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  let previous = 0;
  const pots: Pot[] = [];
  for (const height of heights) {
    const contributors = s.players.filter((p) => p.H >= height);
    const eligible = contributors.filter((p) => !p.folded && !p.eliminated).map((p) => p.id);
    const amount = (height - previous) * contributors.length;
    previous = height;
    if (!eligible.length) throw Error('NO_POT_ELIGIBLE');
    const last = pots.at(-1);
    // Folded contributions add money, but cannot create a new winner eligibility boundary.
    if (
      last &&
      last.eligible.length === eligible.length &&
      last.eligible.every((id, i) => id === eligible[i])
    ) {
      last.amount += amount;
    } else pots.push({ id: `pot${pots.length}`, amount, eligible });
  }
  return pots;
}
export function previewSettlement(
  s: GameState,
  winners: WinnerSelection,
  pots = buildPots(s),
): {
  ok: boolean;
  payouts: Record<string, number>;
  error?: SettlementErrorCode;
  allocations?: Array<{
    potId: string;
    amount: number;
    payouts: Record<string, number>;
    remainderRecipients: string[];
  }>;
} {
  const payouts = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  const fail = (error: SettlementErrorCode) => ({ ok: false, payouts, error });
  if (!pots.length) return fail('NO_POT');
  const selected = pots.map((p) => winners[p.id] ?? (p.eligible.length === 1 ? p.eligible : []));
  if (
    pots.some(
      (p, i) =>
        !selected[i].length ||
        new Set(selected[i]).size !== selected[i].length ||
        selected[i].some((id) => !p.eligible.includes(id)),
    )
  )
    return fail('WINNER_REQUIRED');
  const parent = new Map(s.players.map((p) => [p.id, p.id]));
  function find(id: string): string {
    const p = parent.get(id)!;
    if (p === id) return id;
    const r = find(p);
    parent.set(id, r);
    return r;
  }
  selected.forEach((ids) => ids.slice(1).forEach((id) => parent.set(find(id), find(ids[0]))));
  const edges = new Map<string, Set<string>>();
  for (let i = 0; i < pots.length; i++) {
    const winner = find(selected[i][0]);
    for (const loser of pots[i].eligible.filter((id) => !selected[i].includes(id))) {
      const to = find(loser);
      if (winner === to) return fail('TIE_CONFLICT');
      if (!edges.has(winner)) edges.set(winner, new Set());
      edges.get(winner)!.add(to);
    }
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function cycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const to of edges.get(id) ?? []) if (cycle(to)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  for (const id of edges.keys()) if (cycle(id)) return fail('POT_ORDER_CONFLICT');
  const allocations: Array<{
    potId: string;
    amount: number;
    payouts: Record<string, number>;
    remainderRecipients: string[];
  }> = [];
  pots.forEach((pot, i) => {
    const button = s.hand!.buttonSeat,
      count = s.players.length,
      order = [...selected[i]].sort((a, b) => {
        const rank = (id: string) =>
          (s.players.findIndex((p) => p.id === id) - button - 1 + count) % count;
        return rank(a) - rank(b);
      });
    const units = pot.amount / 5,
      share = Math.floor(units / order.length),
      remainder = units % order.length;
    const perPot = Object.fromEntries(
      order.map((id, k) => [id, (share + (k < remainder ? 1 : 0)) * 5]),
    );
    order.forEach((id) => (payouts[id] += perPot[id]));
    allocations.push({
      potId: pot.id,
      amount: pot.amount,
      payouts: perPot,
      remainderRecipients: order.slice(0, remainder),
    });
  });
  return { ok: true, payouts, allocations };
}
