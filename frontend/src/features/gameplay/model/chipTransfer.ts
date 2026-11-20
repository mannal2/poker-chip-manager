// 칩이 한 곳에서 다른 곳으로 날아가는 애니메이션 한 건
export interface ChipTransfer {
  from: string;
  to: string;
  amount: number;
  delay: number;
  kind: 'bet' | 'return' | 'payout';
}

// 지급 이동을 수령자별로 합쳐 카드 위에 띄울 금액 목록을 만든다
/** One label per recipient: payouts only, summed, timed with that recipient's last flight. */
export function payoutGains(moves: ChipTransfer[]): { to: string; amount: number; delay: number }[] {
  const gains = new Map<string, { to: string; amount: number; delay: number }>();
  for (const move of moves) {
    if (move.kind !== 'payout') continue;
    const gain = gains.get(move.to);
    if (gain) {
      gain.amount += move.amount;
      gain.delay = Math.max(gain.delay, move.delay);
    } else gains.set(move.to, { to: move.to, amount: move.amount, delay: move.delay });
  }
  return [...gains.values()];
}
