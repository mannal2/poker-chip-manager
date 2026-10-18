import type { GameEvent } from '../game/types';
const actions: Record<string, string> = {
  CHECK: '체크',
  CALL: '콜',
  BET: '베팅',
  RAISE: '레이즈',
  ALL_IN: '올인',
  FOLD: '폴드',
};
export interface HistoryRow {
  id: string;
  hand: number;
  text: string;
  kind: 'hand' | 'stage' | 'action';
}
export function historyRows(
  events: GameEvent[],
  players: { id: string; name: string }[],
): HistoryRow[] {
  const active: GameEvent[] = [];
  for (const event of events) {
    if (event.type === 'UNDO') {
      for (let i = active.length - 1; i >= 0 && active[i].hand === event.hand; i--) {
        if (actions[active[i].type]) {
          active.splice(i, 1);
          break;
        }
      }
    } else active.push(event);
  }
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '참가자';
  const chips = (n: number) => n.toLocaleString('ko-KR') + '칩';
  const rows: HistoryRow[] = [];
  let hand = -1,
    stage = '';
  const addStage = (text: string, event: GameEvent) => {
    if (stage === text) return;
    stage = text;
    rows.push({ id: event.id + ':stage:' + text, hand: event.hand, kind: 'stage', text });
  };
  for (const event of active) {
    const d = event.details as {
      playerId?: string;
      additional?: number;
      amount?: number;
      payouts?: Record<string, number>;
      street?: number;
      showdown?: boolean;
    };
    if (
      !event.hand ||
      !(
        actions[event.type] ||
        ['HAND_START', 'STREET', 'PAYOUT', 'RETURN'].includes(event.type) ||
        (event.type === 'REVEAL' && d.showdown)
      )
    )
      continue;
    if (hand !== event.hand) {
      hand = event.hand;
      stage = '';
      rows.push({
        id: 'hand:' + hand,
        hand,
        kind: 'hand',
        text: 'HAND ' + String(hand).padStart(2, '0'),
      });
      addStage('프리플랍', event);
    }
    if (event.type === 'STREET') {
      const text = ['프리플랍', '플랍', '턴', '리버'][d.street!];
      if (text) addStage(text, event);
    } else if (event.type === 'REVEAL') addStage('쇼다운', event);
    else if (event.type === 'PAYOUT') {
      if (stage !== '쇼다운') addStage('핸드 종료', event);
      for (const [id, amount] of Object.entries(d.payouts ?? {})) {
        if (amount > 0)
          rows.push({
            id: event.id + ':' + id,
            hand,
            kind: 'action',
            text: `${name(id)} - ${chips(amount)} 획득`,
          });
      }
    } else if (event.type === 'RETURN' && d.playerId) {
      rows.push({
        id: event.id,
        hand,
        kind: 'action',
        text: `${name(d.playerId)} - 미콜 ${chips(d.amount!)} 반환`,
      });
    } else if (actions[event.type] && d.playerId) {
      const amount = ['CHECK', 'FOLD'].includes(event.type) ? '' : ' ' + chips(d.additional!);
      rows.push({
        id: event.id,
        hand,
        kind: 'action',
        text: `${name(d.playerId)} - ${actions[event.type]}${amount}`,
      });
    }
  }
  return rows;
}
