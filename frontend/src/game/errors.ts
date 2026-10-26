/** Rule-level rejection codes shared by local rules and the future server; UI maps them to text. */
export type SettingsErrorCode = 'INVALID_NAMES' | 'INVALID_CHIP_SETTINGS' | 'INVALID_SEATS';
export type SettlementErrorCode =
  'NO_POT' | 'WINNER_REQUIRED' | 'TIE_CONFLICT' | 'POT_ORDER_CONFLICT';
/** Why the current actor cannot (re-)raise, or why nobody can act. */
export type LegalReasonCode = 'NOT_ACTOR' | 'NO_OPPONENT' | 'RAISE_CLOSED';
export type DraftRejection = 'NOT_ACTOR' | 'BELOW_CALL' | 'RAISE_CLOSED' | 'MIN_RAISE';
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
