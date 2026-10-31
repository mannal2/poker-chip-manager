// 칩이 한 곳에서 다른 곳으로 날아가는 애니메이션 한 건
export interface ChipTransfer {
  from: string;
  to: string;
  amount: number;
  delay: number;
  kind: 'bet' | 'return' | 'payout';
}
