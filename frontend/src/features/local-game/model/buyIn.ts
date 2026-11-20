import type { BuyInPlacement, GameState } from '../../../game/types';

const MAX_SEATS = 10;

// 바이인 대화상자에 보이는 자리 하나
export type SeatOption = { key: string; placement: BuyInPlacement; label: string };

// 앉을 수 있는 자리(사이 자리와 탈락자의 빈자리)를 자리 순서대로 만든다
export function seatOptions(state: GameState): SeatOption[] {
  const players = state.players;
  const options: SeatOption[] = [];
  players.forEach((p, i) => {
    if (p.eliminated && !p.joining)
      options.push({
        key: `replace:${p.id}`,
        placement: { kind: 'replace', playerId: p.id },
        label: `${p.name}의 빈자리`,
      });
    if (players.length < MAX_SEATS)
      options.push({
        key: `between:${p.id}`,
        placement: { kind: 'between', after: p.id },
        label: `${p.name}·${players[(i + 1) % players.length].name} 사이`,
      });
  });
  return options;
}

// 바이인을 할 수 없는 이유를 돌려주고 가능하면 null이다
export function buyInBlockReason(state: GameState): string | null {
  if (state.status !== 'playing') return '진행 중인 토너먼트에서만 바이인할 수 있습니다.';
  if (seatOptions(state).length === 0) return '빈자리가 없어 바이인할 수 없습니다.';
  return null;
}
