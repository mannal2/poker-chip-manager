// 설정 검증 실패 사유 코드
/** Rule-level rejection codes shared by local rules and the future server; UI maps them to text. */
export type SettingsErrorCode = 'INVALID_NAMES' | 'INVALID_CHIP_SETTINGS' | 'INVALID_SEATS';
// 정산 불가 사유 코드
export type SettlementErrorCode =
  'NO_POT' | 'WINNER_REQUIRED' | 'TIE_CONFLICT' | 'POT_ORDER_CONFLICT';
/** Why the current actor cannot (re-)raise, or why nobody can act. */
export type LegalReasonCode = 'NOT_ACTOR' | 'NO_OPPONENT' | 'RAISE_CLOSED';
// 베팅 입력이 거절된 사유 코드
export type DraftRejection = 'NOT_ACTOR' | 'BELOW_CALL' | 'RAISE_CLOSED' | 'MIN_RAISE';
// 규칙 위반 거절 사유 코드 전체
export type RuleErrorCode =
  | 'INVALID_ACTION'
  | 'INVALID_AMOUNT'
  | 'MIN_RAISE'
  | 'RAISE_CLOSED'
  | 'INVALID_BLINDS'
  | 'DEALER_REQUIRED'
  | 'INVALID_SETTINGS'
  | 'UNDO_LOCKED'
  | SettlementErrorCode;
