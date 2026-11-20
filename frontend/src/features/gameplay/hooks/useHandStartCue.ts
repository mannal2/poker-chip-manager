import { useState } from 'react';
import type { GameSession } from '../session';

// 새 핸드가 시작될 때마다 1씩 늘어나는 신호 번호를 돌려준다
/**
 * 0 until a hand number rises past the one last rendered. First render, restore, undo (number falls)
 * and, online, a jump that does not continue the rendered version (reconnect, resync) never count —
 * the same rule BoardCards uses for its reveal.
 */
export function useHandStartCue(
  handNumber: number | undefined,
  reveal?: GameSession['boardReveal'],
): number {
  const version = reveal?.version;
  const [seen, setSeen] = useState({ hand: handNumber, version, cue: 0 });
  if (seen.hand === handNumber && seen.version === version) return seen.cue;
  const continues = reveal?.from === undefined || reveal.from === seen.version;
  const rose = handNumber !== undefined && seen.hand !== undefined && handNumber > seen.hand;
  const cue = rose && continues ? seen.cue + 1 : seen.cue;
  setSeen({ hand: handNumber, version, cue });
  return cue;
}
