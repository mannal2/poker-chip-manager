import type {
  DraftRejection,
  LegalReasonCode,
  RuleErrorCode,
  SettingsErrorCode,
} from '../../../game/errors';
import type { SessionRejectionCode } from '../session';

export type ErrorCode =
  RuleErrorCode | SettingsErrorCode | LegalReasonCode | DraftRejection | SessionRejectionCode;

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
};

/**
 * Text for a rejection code. Unknown codes keep the code visible for support; non-code text
 * (exception messages, results stored before codes existed) is shown as is.
 */
export function messageFor(code: string | undefined | null): string {
  if (!code) return '처리할 수 없습니다.';
  if (code in errorMessages) return errorMessages[code as ErrorCode];
  return /^[A-Z][A-Z_]*$/.test(code) ? `처리할 수 없습니다. (${code})` : code;
}
