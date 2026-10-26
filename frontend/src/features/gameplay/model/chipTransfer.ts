export interface ChipTransfer {
  from: string;
  to: string;
  amount: number;
  delay: number;
  kind: 'bet' | 'return' | 'payout';
}
