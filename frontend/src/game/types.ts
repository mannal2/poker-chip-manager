import type { GameSettings } from './settings';
export interface Player {
  id: string;
  name: string;
  stack: number;
  eliminated: boolean;
  folded: boolean;
  B: number;
  H: number;
  actedAt: number | null;
  reopenAt: number;
}
export type Phase = 'betting' | 'revealPending' | 'revealed' | 'settlement';
export interface Hand {
  id: string;
  number: number;
  street: number;
  phase: Phase;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  sb: number;
  bb: number;
  actorId: string | null;
  W: number;
  R: number;
  pending: string[];
  showdown: boolean;
}
export interface GameState {
  tournamentId: string;
  version: number;
  status: 'setup' | 'playing' | 'ended' | 'aborted';
  settings: GameSettings;
  initialTotal: number;
  setupOrder?: string[];
  players: Player[];
  hand: Hand | null;
  pot: number;
  pendingBlinds: { sb: number; bb: number } | null;
  undo: Omit<GameState, 'undo'> | null;
}
export type WinnerSelection = Record<string, string[]>;
export type GameCommand = {
  type:
    | 'RESUME_FLOW'
    | 'START_TOURNAMENT'
    | 'CHECK'
    | 'CALL'
    | 'BET'
    | 'RAISE'
    | 'FOLD'
    | 'ALL_IN'
    | 'UNDO'
    | 'BEGIN_REVEAL'
    | 'ADVANCE_STREET'
    | 'SETTLE_HAND'
    | 'SCHEDULE_BLINDS'
    | 'ABORT'
    | 'SETUP_UPDATE'
    | 'SET_VIEW';
  playerId?: string;
  additional?: number;
  winners?: WinnerSelection;
  sb?: number;
  bb?: number;
  settings?: GameSettings;
  order?: string[];
  viewSeat?: number;
};
export interface TransitionContext {
  id: string;
  at: string;
}
export interface GameEvent {
  id: string;
  at: string;
  tournamentId: string;
  hand: number;
  type: string;
  details: unknown;
  sequence?: number;
}
export type TransitionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; errorCode: string };
export interface LegalActions {
  actor: Player | null;
  callAdditional: number;
  minRaiseAdditional: number;
  maxAdditional: number;
  canRaise: boolean;
  canCheck: boolean;
  canCall: boolean;
  reason: string;
}
export interface Pot {
  id: string;
  amount: number;
  eligible: string[];
}
