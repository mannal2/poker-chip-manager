import type { RoomParticipant, RoomSnapshot, ServerCommand } from '../api/types';

// 관리 메뉴 항목 하나
export interface MenuItem {
  label: string;
  home?: boolean;
  command?: ServerCommand;
  targets?: RoomParticipant[];
  confirm?: string;
  // 같은 값을 가진 연속 항목은 한 줄에 나란히 표시한다
  row?: string;
  // 확인 뒤 방에 남을지 나갈지 한 번 더 묻는다
  then?: 'stay-or-leave';
  // 누를 수 없는 안내 문구로 표시한다
  notice?: boolean;
  // 명령 대신 따로 대화상자를 연다
  opens?: 'buy-ins';
}

export const forfeitWarning =
  '지금 폴드하고 탈락합니다. 남은 칩은 다른 플레이어에게 나눠지며 되돌릴 수 없습니다.';
export const resetWarning =
  '결과와 기록을 지우고, 이름과 자리는 그대로 두고 다시 준비합니다.';
export const leaveWarning = '나가면 이 게임에 다시 들어올 수 없습니다.';

// 서버 게임의 기권과 탈락 상태를 모두 확인해 아직 게임에 남은 참가자인지 판별한다
export function inPlay(snapshot: RoomSnapshot, participant: RoomParticipant) {
  return (
    snapshot.game?.players.some(
      (p) => p.id === participant.playerId && !p.eliminated && !p.forfeited,
    ) ?? false
  );
}

// 서버가 재입장 신청을 받는 탈락자(탈락했거나 자리를 다른 바이인에게 내준 사람)인지 판별한다
export function canRequestReentry(snapshot: RoomSnapshot, participant: RoomParticipant) {
  const game = snapshot.game;
  if (!game || game.status !== 'playing' || !participant.playerId) return false;
  const player = game.players.find((p) => p.id === participant.playerId);
  if (player) return player.eliminated;
  return (
    game.formerPlayers?.some((f) => f.id === participant.playerId && f.reason === 'replaced') ??
    false
  );
}

// 탈락한 본인이 이미 재입장을 신청해 방장의 승인을 기다리는지 확인한다
export function reentryPending(snapshot: RoomSnapshot, me: RoomParticipant) {
  return snapshot.buyInRequests.some((r) => r.reentryOf === me.playerId);
}

// 탈락한 본인의 바이인 버튼, 또는 이미 신청했으면 그 자리의 대기 안내를 만든다
function reentryItem(snapshot: RoomSnapshot, me: RoomParticipant): MenuItem | null {
  if (!canRequestReentry(snapshot, me)) return null;
  if (reentryPending(snapshot, me))
    return { label: '방장의 승인을 기다리고 있습니다.', notice: true };
  return { label: '바이인', command: { type: 'REQUEST_BUY_IN', handScoped: false } };
}

// 역할과 단계 및 서버 명단의 생존 여부로 관리 메뉴와 대상을 구성한다
export function menuItems(snapshot: RoomSnapshot): MenuItem[] {
  const host = snapshot.you.participantId === snapshot.hostId;
  const playing = snapshot.roomPhase === 'PLAYING';
  const me = snapshot.participants.find((p) => p.participantId === snapshot.you.participantId);
  const others = snapshot.participants.filter(
    (p) => p.participantId !== snapshot.you.participantId,
  );
  const items: MenuItem[] = [{ label: '홈', home: true }];
  if (!playing)
    items.push({ label: '방 나가기', command: { type: 'LEAVE', handScoped: false } });
  if (playing) {
    // 방장은 대기 바이인 대화상자 하나에서 취소와 자기 재입장 신청을 모두 한다
    if (host && snapshot.game?.status === 'playing')
      items.push({ label: '바이인', opens: 'buy-ins' });
    const reentry = !host && me && reentryItem(snapshot, me);
    if (reentry) items.push(reentry);
    if (me && inPlay(snapshot, me))
      items.push({
        label: '기권',
        command: { type: 'FORFEIT', handScoped: false },
        confirm: forfeitWarning,
        then: 'stay-or-leave',
      });
    else if (!host)
      items.push({
        label: '방 나가기',
        command: { type: 'LEAVE', handScoped: false },
        confirm: leaveWarning,
      });
    if (host) {
      const stillIn = others.filter((p) => inPlay(snapshot, p));
      const out = others.filter((p) => !inPlay(snapshot, p));
      if (stillIn.length)
        items.push({
          label: '기권 처리',
          command: { type: 'FORFEIT_DISCONNECTED', handScoped: false },
          targets: stillIn,
          confirm: forfeitWarning,
          row: 'participant-actions',
          then: 'stay-or-leave',
        });
      if (out.length)
        items.push({
          label: '내보내기',
          command: { type: 'KICK', handScoped: false },
          targets: out,
          row: 'participant-actions',
        });
    }
  }
  if (host) {
    items.push({
      label: '방장 넘기기',
      command: { type: 'TRANSFER_HOST', handScoped: false },
      targets: others.filter((p) => !playing || inPlay(snapshot, p)),
    });
    if (snapshot.roomPhase === 'WAITING')
      items.push({
        label: '플레이어 내보내기',
        command: { type: 'KICK', handScoped: false },
        targets: others,
      });
    if (playing)
      items.push({
        label: '토너먼트 중단',
        command: { type: 'ABORT_AND_RE_READY', handScoped: false },
        confirm:
          '게임과 기록을 지우고 준비 화면으로 돌아갑니다.',
      });
    if (snapshot.roomPhase === 'RESULT')
      items.push({
        label: '다시 준비하기',
        command: { type: 'RE_READY', handScoped: false },
        confirm: resetWarning,
      });
  }
  return items;
}

// 같은 row 값을 가진 연속 항목을 한 줄로 묶는다
function menuRows(items: MenuItem[]): MenuItem[][] {
  const rows: MenuItem[][] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.row && last?.[0].row === item.row) last.push(item);
    else rows.push([item]);
  }
  return rows;
}

// 공통 관리 대화상자 안에서 메뉴와 방 코드 복사 조작을 표시한다
export function OnlineMenu({
  snapshot,
  choose,
  home,
  notify,
}: {
  snapshot: RoomSnapshot;
  choose: (item: MenuItem) => void;
  home: () => void;
  notify: (message: string) => void;
}) {
  const items = menuItems(snapshot);
  // 초대 링크 대신 방 코드만 복사한다
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(snapshot.code);
      notify('방 코드를 복사했습니다.');
    } catch {
      notify('방 코드를 복사하지 못했습니다.');
    }
  }
  return (
    <div className="menu-actions">
      <button onClick={() => void copyCode()}>방 코드 {snapshot.code} 복사</button>
      {menuRows(items).map((row) => (
        <div key={row.map((item) => item.label).join('/')} className={row.length > 1 ? 'menu-row' : undefined}>
          {row.map((item) =>
            item.notice ? (
              <p key={item.label} role="status">
                {item.label}
              </p>
            ) : (
              <button key={item.label} onClick={() => (item.home ? home() : choose(item))}>
                {item.label}
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
