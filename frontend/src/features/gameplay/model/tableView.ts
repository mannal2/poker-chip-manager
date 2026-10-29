import { initialBlindSeats } from '../../../game/positions';
import type { GameState, Pot, WinnerSelection } from '../../../game/types';

export function buildTableView(
  state: GameState,
  {
    draftAmount,
    pots,
    potIndex,
    winners,
  }: {
    draftAmount: number;
    pots: Pot[];
    potIndex: number;
    winners: WinnerSelection;
  },
) {
  const button = state.hand?.buttonSeat ?? state.settings.button ?? 0;
  let sb = button,
    bb = button;
  if (state.hand) {
    sb = state.hand.sbSeat;
    bb = state.hand.bbSeat;
  } else if (button >= 0) {
    ({ sbSeat: sb, bbSeat: bb } = initialBlindSeats(
      button,
      state.players.map(() => true),
    ));
  }
  const currentPot = pots[potIndex];
  return {
    players: state.players.map((p, i) => ({
      ...p,
      contribution: p.H + (state.hand?.actorId === p.id ? draftAmount : 0),
      pending: state.hand?.actorId === p.id && draftAmount > 0,
      roles: [
        i === button ? 'D' : '',
        button >= 0 && i === sb && !p.eliminated ? 'SB' : '',
        button >= 0 && i === bb ? 'BB' : '',
        p.eliminated ? '탈락' : p.folded ? '폴드' : p.stack === 0 ? '올인' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      active: state.status === 'playing' && state.hand?.actorId === p.id,
      out: p.eliminated,
      selected: currentPot ? winners[currentPot.id].includes(p.id) : false,
      eligible: currentPot?.eligible.includes(p.id),
    })),
    pot: currentPot?.amount ?? state.pot,
    notice: state.hand && state.players[state.hand.sbSeat].eliminated ? 'SB 없음' : undefined,
    potLabel:
      currentPot && pots.length > 1
        ? potIndex === 0
          ? 'MAIN POT'
          : 'SIDE POT ' + potIndex
        : undefined,
    phase: state.status === 'setup' ? 'setup' : (state.hand?.phase ?? ''),
    street: ['PREFLOP', 'FLOP', 'TURN', 'RIVER'][state.hand?.street ?? 0],
    handKey: state.hand?.id,
  };
}
