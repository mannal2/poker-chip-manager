const LAST = 'online.lastRoom';
const TAB = 'online.controlRoom';
const RECOVERY = 'online.recoveryRequest';

// 마지막 방의 식별자를 읽고 형식이 깨졌으면 저장값을 지운다
export function savedRoomId(): string | null {
  const saved = localStorage.getItem(LAST);
  if (!saved) return null;
  try {
    return (JSON.parse(saved) as { roomId: string }).roomId;
  } catch {
    forgetRoom();
    return null;
  }
}

// 다시 찾을 방과 이 탭의 조작 표시를 저장한다
export function rememberRoom(roomId: string, code: string): void {
  localStorage.setItem(LAST, JSON.stringify({ roomId, code }));
  markTabControl(roomId);
}

// 저장된 방과 이 탭의 조작 표시를 지운다
export function forgetRoom(): void {
  localStorage.removeItem(LAST);
  clearTabControl();
}

// 이 탭이 조작하던 방인지 확인한다
export function tabControls(roomId: string): boolean {
  return sessionStorage.getItem(TAB) === roomId;
}

// 이 탭이 방을 조작한다고 표시한다
export function markTabControl(roomId: string): void {
  sessionStorage.setItem(TAB, roomId);
}

// 이 탭의 조작 표시를 지운다
export function clearTabControl(): void {
  sessionStorage.removeItem(TAB);
}

// 이 탭에서 기다리던 복구 신청을 읽는다
export function savedRecovery(): string | null {
  return sessionStorage.getItem(RECOVERY);
}

// 새로고침 뒤에도 조회하도록 복구 신청을 저장한다
export function rememberRecovery(id: string): void {
  sessionStorage.setItem(RECOVERY, id);
}

// 끝난 복구 신청을 지운다
export function forgetRecovery(): void {
  sessionStorage.removeItem(RECOVERY);
}
