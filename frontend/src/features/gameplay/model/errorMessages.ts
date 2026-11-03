import type {
  DraftRejection,
  LegalReasonCode,
  RuleErrorCode,
  SettingsErrorCode,
} from '../../../game/errors';
import type { SessionRejectionCode } from '../session';

// 화면에 안내할 수 있는 모든 거절 사유 코드
export type ErrorCode =
  | RuleErrorCode
  | SettingsErrorCode
  | LegalReasonCode
  | DraftRejection
  | SessionRejectionCode
  | ServerErrorCode;

// 서버가 온라인 참가와 방 운영에서 반환하는 거절 사유 코드다
export type ServerErrorCode =
  | 'NOT_YOUR_TURN'
  | 'NOT_WAITING'
  | 'NO_DEALER'
  | 'NOT_CONNECTED'
  | 'PLAYER_COUNT'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_LIMIT'
  | 'NO_SESSION'
  | 'RATE_LIMITED'
  | 'SESSION_LIMIT'
  | 'INVALID_NAME'
  | 'DUPLICATE_NAME'
  | 'TRANSFER_HOST_FIRST'
  | 'ABORT_FIRST'
  | 'TARGET_CONNECTED'
  | 'HOST_TAKEOVER_CLOSED'
  | 'RECOVERY_LIMIT'
  | 'RECOVERY_NOT_PENDING'
  | 'RECOVERY_TARGET_NOT_FOUND'
  | 'ALREADY_PARTICIPANT'
  | 'FORBIDDEN'
  | 'DEPLOY_PENDING'
  | 'UNDO_DEPLOY_PENDING';

// 거절 사유 코드별 한국어 안내 문구
export const errorMessages: Record<ErrorCode, string> = {
  INVALID_ACTION: '지금 할 수 없는 조작입니다.',
  INVALID_AMOUNT: '칩 금액을 확인하세요.',
  MIN_RAISE: '최소 레이즈 금액보다 적습니다.',
  RAISE_CLOSED: '완전 레이즈만큼 증가하지 않아 재레이즈할 수 없습니다.',
  INVALID_BLINDS: '블라인드는 5 단위, SB < BB로 설정하세요.',
  DEALER_REQUIRED: '첫 딜러로 시작할 플레이어 카드를 선택하세요.',
  INVALID_SETTINGS: '게임 설정을 확인하세요.',
  UNDO_LOCKED: '취소할 직전 행동이 없습니다.',
  NO_POT: '정산할 팟이 없습니다.',
  WINNER_REQUIRED: '모든 팟에서 자격 있는 승자를 선택하세요.',
  TIE_CONFLICT: '동률과 승패 선택이 충돌합니다.',
  POT_ORDER_CONFLICT: '팟 사이 승패 선택이 충돌합니다.',
  INVALID_NAMES: '이름은 1~10자의 한글·영문·숫자, 중복 없이 2~10명으로 설정하세요.',
  INVALID_CHIP_SETTINGS: '5 단위, 0 < SB < BB ≤ 시작 칩 (최대 1,000,000)으로 설정하세요.',
  INVALID_SEATS: '좌석을 확인하세요.',
  NOT_ACTOR: '지금은 베팅 차례가 아닙니다.',
  NO_OPPONENT: '응답할 칩이 있는 상대가 없습니다.',
  BELOW_CALL: '콜 금액 이상으로 칩을 선택하세요.',
  CONTROL_LOST: '다른 화면에서 조작 중입니다.',
  STALE_STATE: '다른 화면에서 게임이 바뀌었습니다. 최신 상태로 다시 시도하세요.',
  TOURNAMENT_CHANGED: '다른 화면에서 새 토너먼트가 시작되었습니다.',
  NO_GAME: '저장된 게임이 없습니다.',
  REQUEST_CONFLICT: '이전 요청과 충돌합니다. 화면을 다시 열어주세요.',
  RESULT_EXPIRED: '오래된 요청이라 결과를 확인할 수 없습니다.',
  SEQUENCE_GAP: '요청 순서가 맞지 않습니다. 화면을 다시 열어주세요.',
  REQUEST_PENDING: '저장 완료를 기다려주세요.',
  NO_PENDING_REQUEST: '재시도할 요청이 없습니다.',
  NOT_YOUR_TURN: '지금은 내 차례가 아닙니다.',
  NOT_WAITING: '이미 게임이 시작된 방입니다.',
  NO_DEALER: '첫 딜러로 시작할 플레이어 카드를 선택하세요.',
  NOT_CONNECTED: '접속하지 않은 참가자가 있습니다.',
  PLAYER_COUNT: '참가자는 2~10명이어야 합니다.',
  ROOM_FULL: '방이 가득 찼습니다.',
  ROOM_NOT_FOUND: '방을 찾을 수 없습니다.',
  ROOM_LIMIT: '지금은 방을 더 만들 수 없습니다.',
  NO_SESSION: '세션이 만료되었습니다. 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
  SESSION_LIMIT: '접속자가 많습니다. 잠시 뒤 다시 시도해 주세요.',
  INVALID_NAME: '이름은 한글, 영문, 숫자, 공백으로 1~10자여야 합니다.',
  DUPLICATE_NAME: '같은 이름이 이미 있습니다.',
  TRANSFER_HOST_FIRST: '방장은 방장을 넘긴 뒤에 기권할 수 있습니다.',
  ABORT_FIRST: '진행 중인 게임을 먼저 중단해 주세요.',
  TARGET_CONNECTED: '접속 중인 참가자는 기권 처리할 수 없습니다.',
  HOST_TAKEOVER_CLOSED: '방장 인수 요청이 이미 닫혔습니다.',
  RECOVERY_LIMIT: '이 자리의 복구 신청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
  RECOVERY_NOT_PENDING: '이미 처리되었거나 만료된 복구 신청입니다.',
  RECOVERY_TARGET_NOT_FOUND: '이 이름의 자리를 찾을 수 없습니다.',
  ALREADY_PARTICIPANT: '이미 이 방에 참가하고 있습니다.',
  FORBIDDEN: '이 작업을 할 권한이 없습니다.',
  DEPLOY_PENDING: '서버 업데이트가 끝나면 시작할 수 있습니다',
  UNDO_DEPLOY_PENDING: '서버 업데이트 중이라 취소할 수 없습니다',
};

// 거절 코드를 사용자에게 보여줄 문구로 바꾼다
/**
 * Text for a rejection code. Unknown codes keep the code visible for support; non-code text
 * (exception messages, results stored before codes existed) is shown as is.
 */
export function messageFor(code: string | undefined | null): string {
  if (!code) return '처리할 수 없습니다.';
  if (code in errorMessages) return errorMessages[code as ErrorCode];
  return /^[A-Z][A-Z_]*$/.test(code) ? `처리할 수 없습니다. (${code})` : code;
}
