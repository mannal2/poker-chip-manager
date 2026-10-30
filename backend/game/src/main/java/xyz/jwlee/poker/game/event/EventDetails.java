package xyz.jwlee.poker.game.event;

import java.util.LinkedHashMap;
import java.util.List;
import xyz.jwlee.poker.game.model.ActionType;

/** Per-kind event payloads; {@link #type()} is the TS event type string. */
public sealed interface EventDetails {
    String type();

    record HandStarted(int buttonSeat, int sbSeat, int bbSeat, int smallBlind, int bigBlind)
            implements EventDetails {
        @Override
        public String type() {
            return "HAND_START";
        }
    }

    record PlayerActed(ActionType action, String playerId, int additional) implements EventDetails {
        @Override
        public String type() {
            return action.name();
        }
    }

    record UncalledReturned(String playerId, int amount) implements EventDetails {
        @Override
        public String type() {
            return "RETURN";
        }
    }

    record RoundClosed(boolean showdown) implements EventDetails {
        @Override
        public String type() {
            return "REVEAL";
        }
    }

    record StreetStarted(int street) implements EventDetails {
        @Override
        public String type() {
            return "STREET";
        }
    }

    /** {@code payouts} maps player id to chips, in payout order. */
    record PotsPaid(int pot, LinkedHashMap<String, Integer> payouts) implements EventDetails {
        @Override
        public String type() {
            return "PAYOUT";
        }
    }

    record PlayerEliminated(String playerId) implements EventDetails {
        @Override
        public String type() {
            return "ELIMINATED";
        }
    }

    record TournamentEnded(String winner) implements EventDetails {
        @Override
        public String type() {
            return "TOURNAMENT_END";
        }
    }

    record BlindsScheduled(int smallBlind, int bigBlind) implements EventDetails {
        @Override
        public String type() {
            return "BLINDS_SCHEDULED";
        }
    }

    /** {@code eventIds} is null when the undone action carried none. */
    record ActionUndone(List<String> eventIds) implements EventDetails {
        @Override
        public String type() {
            return "UNDO";
        }
    }

    record TournamentAborted() implements EventDetails {
        @Override
        public String type() {
            return "ABORT";
        }
    }

    record PlayerForfeited(String playerId) implements EventDetails {
        @Override
        public String type() {
            return "FORFEIT";
        }
    }

    /** {@code shares} maps player id to the chips received from the forfeited stack. */
    record ForfeitStackSplit(String playerId, LinkedHashMap<String, Integer> shares) implements EventDetails {
        @Override
        public String type() {
            return "FORFEIT_SPLIT";
        }
    }
}
