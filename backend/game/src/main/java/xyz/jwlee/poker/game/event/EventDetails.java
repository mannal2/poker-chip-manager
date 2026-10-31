package xyz.jwlee.poker.game.event;

import java.util.LinkedHashMap;
import java.util.List;
import xyz.jwlee.poker.game.model.ActionType;

// 이벤트 종류별 상세 내용을 나타낸다
/** Per-kind event payloads; {@link #type()} is the TS event type string. */
public sealed interface EventDetails {
    // 이벤트 종류를 나타내는 문자열을 돌려준다
    String type();

    // 핸드 시작 이벤트(버튼/블라인드 좌석과 금액)
    record HandStarted(int buttonSeat, int sbSeat, int bbSeat, int smallBlind, int bigBlind)
            implements EventDetails {
        @Override
        public String type() {
            return "HAND_START";
        }
    }

    // 플레이어가 베팅 행동을 한 이벤트
    record PlayerActed(ActionType action, String playerId, int additional) implements EventDetails {
        @Override
        public String type() {
            return action.name();
        }
    }

    // 콜되지 않은 칩이 반환된 이벤트
    record UncalledReturned(String playerId, int amount) implements EventDetails {
        @Override
        public String type() {
            return "RETURN";
        }
    }

    // 베팅 라운드가 끝난 이벤트
    record RoundClosed(boolean showdown) implements EventDetails {
        @Override
        public String type() {
            return "REVEAL";
        }
    }

    // 새 스트리트가 시작된 이벤트
    record StreetStarted(int street) implements EventDetails {
        @Override
        public String type() {
            return "STREET";
        }
    }

    // 팟이 승자들에게 지급된 이벤트
    /** {@code payouts} maps player id to chips, in payout order. */
    record PotsPaid(int pot, LinkedHashMap<String, Integer> payouts) implements EventDetails {
        @Override
        public String type() {
            return "PAYOUT";
        }
    }

    // 플레이어가 탈락한 이벤트
    record PlayerEliminated(String playerId) implements EventDetails {
        @Override
        public String type() {
            return "ELIMINATED";
        }
    }

    // 토너먼트가 우승자와 함께 끝난 이벤트
    record TournamentEnded(String winner) implements EventDetails {
        @Override
        public String type() {
            return "TOURNAMENT_END";
        }
    }

    // 다음 블라인드가 예약된 이벤트
    record BlindsScheduled(int smallBlind, int bigBlind) implements EventDetails {
        @Override
        public String type() {
            return "BLINDS_SCHEDULED";
        }
    }

    // 이전 행동이 되돌려진 이벤트
    /** {@code eventIds} is null when the undone action carried none. */
    record ActionUndone(List<String> eventIds) implements EventDetails {
        @Override
        public String type() {
            return "UNDO";
        }
    }

    // 토너먼트가 중단된 이벤트
    record TournamentAborted() implements EventDetails {
        @Override
        public String type() {
            return "ABORT";
        }
    }

    // 플레이어가 기권한 이벤트
    record PlayerForfeited(String playerId) implements EventDetails {
        @Override
        public String type() {
            return "FORFEIT";
        }
    }

    // 기권자의 스택이 생존자에게 분배된 이벤트
    /** {@code shares} maps player id to the chips received from the forfeited stack. */
    record ForfeitStackSplit(String playerId, LinkedHashMap<String, Integer> shares) implements EventDetails {
        @Override
        public String type() {
            return "FORFEIT_SPLIT";
        }
    }
}
