import type { GameEvent, GameState, LegalActions, WinnerSelection } from '../../../game/types';
import type { GameCapabilities } from '../../gameplay/model/capabilities';

// 방 명단의 참가자 한 명
export interface RoomParticipant {
  participantId: string;
  name: string;
  seat: number;
  playerId: string | null;
  isHost: boolean;
  connected: boolean;
}

// 요청자 시점의 방 전체 상태
export interface RoomSnapshot {
  roomId: string;
  code: string;
  roomPhase: 'WAITING' | 'PLAYING' | 'RESULT';
  stateVersion: number;
  draftVersion: number;
  tournamentId: string | null;
  settings: { initial: number; sb: number; bb: number; button: number };
  hostId: string;
  hostTakeoverOpen: boolean;
  deployPending: boolean;
  participants: RoomParticipant[];
  you: {
    participantId: string;
    controlGeneration: number;
    canTakeHost: boolean;
    capabilities: GameCapabilities;
  };
  game: GameState | null;
  legal: LegalActions | null;
  settlementDraft: { draftVersion: number; potIndex: number; winners: WinnerSelection } | null;
  recoveryRequests: {
    recoveryRequestId: string;
    participantId: string;
    name: string;
    requestedAt: string;
    expiresAt: string;
  }[];
}

// 방 변경을 알리는 소켓 메시지
export interface SnapshotMessage {
  type: 'SNAPSHOT';
  previousVersion: number | null;
  events: GameEvent[];
  state: RoomSnapshot;
}

// 장부에 기록된 명령 결과 응답
export interface CommandResponse {
  requestId: string;
  sequence: number;
  outcome: 'APPLIED' | 'REJECTED';
  code: string;
  resultStateVersion: number;
  latestState: RoomSnapshot | null;
}

// 방 생성과 참가의 성공 응답
export interface JoinResponse {
  roomId: string;
  code: string;
  participantId: string;
  controlGeneration: number;
  state: RoomSnapshot;
}

// 복구 신청 결과 조회 응답
export type RecoveryStatus =
  | ({ recoveryRequestId: string; status: 'APPROVED' } & JoinResponse)
  | {
      recoveryRequestId: string;
      status: 'PENDING' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
      expiresAt?: string;
    };

// 복구 신청 접수 응답
export interface RecoveryRequestResponse {
  recoveryRequestId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED';
  expiresAt: string;
}

// 서버로 보낼 명령 하나
export interface ServerCommand {
  type: string;
  payload?: object;
  handScoped: boolean;
}

// 조작권 인수 성공 응답
export interface ControlResponse {
  requestId: string;
  sequence: number;
  outcome: 'APPLIED';
  controlGeneration: number;
  latestState: RoomSnapshot;
}

// 스냅샷이 화면보다 낮은 (상태 버전, 초안 버전) 쌍인지 확인한다
export function isOlderSnapshot(next: RoomSnapshot, shown: RoomSnapshot): boolean {
  return (
    next.stateVersion < shown.stateVersion ||
    (next.stateVersion === shown.stateVersion && next.draftVersion < shown.draftVersion)
  );
}

// 보낸 요청에 대한 조작권 인수 성공 응답인지 확인한다
export function isControlResponse(
  body: unknown,
  request: Record<string, unknown>,
): body is ControlResponse {
  return (
    object(body) &&
    body.requestId === request.requestId &&
    body.sequence === request.sequence &&
    body.outcome === 'APPLIED' &&
    integer(body.controlGeneration) &&
    isRoomSnapshot(body.latestState)
  );
}

// null과 배열을 제외한 JSON 객체인지 확인한다
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// JSON 정수 필드에 안전한 정수가 들어 있는지 확인한다
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// 문자열 배열의 모든 원소를 확인한다
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// 서버의 플레이어 상태에 필요한 필드와 선택적 기권 표시를 확인한다
function player(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    ['stack', 'B', 'H', 'reopenAt'].every((key) => integer(value[key])) &&
    (value.actedAt === null || integer(value.actedAt)) &&
    typeof value.eliminated === 'boolean' &&
    typeof value.folded === 'boolean' &&
    (value.forfeited === undefined || typeof value.forfeited === 'boolean')
  );
}

// 게임과 취소 스냅샷에서 공유하는 필드의 실제 JSON 형식을 확인한다
function game(value: unknown, undo = false): boolean {
  if (
    !object(value) ||
    typeof value.tournamentId !== 'string' ||
    !integer(value.version) ||
    typeof value.status !== 'string' ||
    !['setup', 'playing', 'ended', 'aborted'].includes(value.status) ||
    !object(value.settings) ||
    !strings(value.settings.names) ||
    !['initial', 'sb', 'bb', 'button'].every((key) =>
      integer((value.settings as Record<string, unknown>)[key]),
    ) ||
    !integer(value.initialTotal) ||
    !integer(value.pot) ||
    !Array.isArray(value.players) ||
    !value.players.every(player) ||
    (value.setupOrder !== undefined && !strings(value.setupOrder))
  )
    return false;
  if (value.hand !== null) {
    const h = value.hand;
    if (
      !object(h) ||
      typeof h.id !== 'string' ||
      typeof h.phase !== 'string' ||
      !['betting', 'settlement'].includes(h.phase) ||
      !['number', 'street', 'buttonSeat', 'sbSeat', 'bbSeat', 'sb', 'bb', 'W', 'R'].every((key) =>
        integer(h[key]),
      ) ||
      !(h.actorId === null || typeof h.actorId === 'string') ||
      !strings(h.pending) ||
      typeof h.showdown !== 'boolean'
    )
      return false;
  }
  if (
    value.pendingBlinds !== null &&
    (!object(value.pendingBlinds) ||
      !integer(value.pendingBlinds.sb) ||
      !integer(value.pendingBlinds.bb))
  )
    return false;
  return undo
    ? value.eventIds === undefined || strings(value.eventIds)
    : value.undo === null || game(value.undo, true);
}

// 정산 초안의 팟별 승자 목록을 확인한다
function winners(value: unknown): boolean {
  return object(value) && Object.values(value).every(strings);
}

// 권한과 명단 및 중첩 게임을 포함한 방 응답 구조를 확인한다
export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  if (
    !object(value) ||
    !['roomId', 'code', 'hostId'].every((key) => typeof value[key] === 'string') ||
    typeof value.roomPhase !== 'string' ||
    !['WAITING', 'PLAYING', 'RESULT'].includes(value.roomPhase) ||
    !integer(value.stateVersion) ||
    !integer(value.draftVersion) ||
    !(value.tournamentId === null || typeof value.tournamentId === 'string') ||
    typeof value.hostTakeoverOpen !== 'boolean' ||
    typeof value.deployPending !== 'boolean' ||
    !object(value.settings) ||
    !['initial', 'sb', 'bb', 'button'].every((key) =>
      integer((value.settings as Record<string, unknown>)[key]),
    ) ||
    !Array.isArray(value.participants) ||
    !value.participants.every(
      (p) =>
        object(p) &&
        typeof p.participantId === 'string' &&
        typeof p.name === 'string' &&
        integer(p.seat) &&
        (p.playerId === null || typeof p.playerId === 'string') &&
        typeof p.isHost === 'boolean' &&
        typeof p.connected === 'boolean',
    )
  )
    return false;
  const you = value.you;
  if (
    !object(you) ||
    typeof you.participantId !== 'string' ||
    !integer(you.controlGeneration) ||
    typeof you.canTakeHost !== 'boolean' ||
    !object(you.capabilities) ||
    !['canAct', 'canUndo', 'canSettle', 'canEditSetup', 'canEditBlinds'].every(
      (key) => typeof (you.capabilities as Record<string, unknown>)[key] === 'boolean',
    )
  )
    return false;
  if (value.game !== null && !game(value.game)) return false;
  if (value.legal !== null) {
    const legal = value.legal;
    if (
      !object(legal) ||
      !(legal.actor === null || player(legal.actor)) ||
      !['callAdditional', 'minRaiseAdditional', 'maxAdditional'].every((key) =>
        integer(legal[key]),
      ) ||
      !['canRaise', 'canCheck', 'canCall'].every((key) => typeof legal[key] === 'boolean') ||
      !(
        legal.reasonCode === null ||
        (typeof legal.reasonCode === 'string' &&
          ['NOT_ACTOR', 'NO_OPPONENT', 'RAISE_CLOSED'].includes(legal.reasonCode))
      )
    )
      return false;
  }
  const draft = value.settlementDraft;
  return (
    (draft === null ||
      (object(draft) &&
        integer(draft.draftVersion) &&
        integer(draft.potIndex) &&
        winners(draft.winners))) &&
    Array.isArray(value.recoveryRequests) &&
    value.recoveryRequests.every(
      (r) =>
        object(r) &&
        ['recoveryRequestId', 'participantId', 'name', 'requestedAt', 'expiresAt'].every(
          (key) => typeof r[key] === 'string',
        ),
    )
  );
}

// 서버 효과 메시지의 이벤트 필드와 상태를 확인한다
export function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  return (
    object(value) &&
    value.type === 'SNAPSHOT' &&
    (value.previousVersion === null || integer(value.previousVersion)) &&
    isRoomSnapshot(value.state) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        object(event) &&
        ['id', 'at', 'tournamentId', 'type'].every((key) => typeof event[key] === 'string') &&
        integer(event.hand) &&
        (event.sequence === undefined || integer(event.sequence)) &&
        eventDetails(event.details),
    )
  );
}

// 이벤트의 추가 정보와 선택적 처리 주체 표시를 확인한다
function eventDetails(value: unknown): boolean {
  return (
    object(value) &&
    ['auto', 'byHost'].every((key) => value[key] === undefined || typeof value[key] === 'boolean')
  );
}

// 적용 또는 거절된 명령 응답과 최신 상태를 확인한다
export function isCommandResponse(value: unknown): value is CommandResponse {
  return (
    object(value) &&
    typeof value.requestId === 'string' &&
    integer(value.sequence) &&
    typeof value.outcome === 'string' &&
    ['APPLIED', 'REJECTED'].includes(value.outcome) &&
    typeof value.code === 'string' &&
    integer(value.resultStateVersion) &&
    (value.latestState === null || isRoomSnapshot(value.latestState))
  );
}

// 방 생성과 참가 및 복구 승인에 쓰는 자리 응답을 확인한다
export function isJoinResponse(value: unknown): value is JoinResponse {
  return (
    object(value) &&
    ['roomId', 'code', 'participantId'].every((key) => typeof value[key] === 'string') &&
    integer(value.controlGeneration) &&
    isRoomSnapshot(value.state)
  );
}

// 승인된 복구에만 자리 정보가 포함되는 상태 응답을 확인한다
export function isRecoveryStatus(value: unknown): value is RecoveryStatus {
  return (
    object(value) &&
    typeof value.recoveryRequestId === 'string' &&
    (value.status === 'APPROVED'
      ? isJoinResponse(value)
      : typeof value.status === 'string' &&
        ['PENDING', 'REJECTED', 'EXPIRED', 'SUPERSEDED'].includes(value.status) &&
        (value.expiresAt === undefined || typeof value.expiresAt === 'string'))
  );
}

// 복구 신청 POST의 최초 응답과 재전송 응답에 포함되는 상태 및 만료 시각을 확인한다
export function isRecoveryRequestResponse(value: unknown): value is RecoveryRequestResponse {
  return (
    object(value) &&
    typeof value.recoveryRequestId === 'string' &&
    typeof value.status === 'string' &&
    ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'].includes(value.status) &&
    typeof value.expiresAt === 'string'
  );
}
