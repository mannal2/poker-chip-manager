export function nextSeat(from: number, eligible: boolean[]): number {
  for (let k = 1; k <= eligible.length; k++) {
    const i = (from + k) % eligible.length;
    if (eligible[i]) return i;
  }
  throw Error('NO_ELIGIBLE_SEAT');
}
export function nextPositions(
  alive: boolean[],
  previous: { buttonSeat: number; sbSeat: number; bbSeat: number },
): { buttonSeat: number; sbSeat: number; bbSeat: number } {
  const bbSeat = nextSeat(previous.bbSeat, alive);
  if (alive.filter(Boolean).length === 2) {
    const buttonSeat = nextSeat(bbSeat, alive);
    return { buttonSeat, sbSeat: buttonSeat, bbSeat };
  }
  const sbSeat = previous.bbSeat;
  let buttonSeat = previous.sbSeat;
  while (!alive[buttonSeat]) {
    const next = (buttonSeat + 1) % alive.length;
    if (next === sbSeat || alive[next]) break;
    buttonSeat = next;
  }
  return { buttonSeat, sbSeat, bbSeat };
}
/** Blind seats for the first hand from a chosen button; heads-up the button posts the SB. */
export function initialBlindSeats(
  button: number,
  alive: boolean[],
): { sbSeat: number; bbSeat: number } {
  const sbSeat = alive.filter(Boolean).length === 2 ? button : nextSeat(button, alive);
  return { sbSeat, bbSeat: nextSeat(sbSeat, alive) };
}
