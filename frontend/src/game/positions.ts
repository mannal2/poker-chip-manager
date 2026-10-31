// 기준 좌석 다음의 조건을 만족하는 좌석을 순환하며 찾는다
export function nextSeat(from: number, eligible: boolean[]): number {
  for (let k = 1; k <= eligible.length; k++) {
    const i = (from + k) % eligible.length;
    if (eligible[i]) return i;
  }
  throw Error('NO_ELIGIBLE_SEAT');
}
// 이전 핸드 기준으로 다음 핸드의 버튼과 블라인드 좌석을 정한다
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
// 첫 핸드의 스몰/빅블라인드 좌석을 버튼에서 계산한다
/** Blind seats for the first hand from a chosen button; heads-up the button posts the SB. */
export function initialBlindSeats(
  button: number,
  alive: boolean[],
): { sbSeat: number; bbSeat: number } {
  const sbSeat = alive.filter(Boolean).length === 2 ? button : nextSeat(button, alive);
  return { sbSeat, bbSeat: nextSeat(sbSeat, alive) };
}
