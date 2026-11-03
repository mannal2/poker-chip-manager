package xyz.jwlee.poker.game.command;

import java.util.List;
import java.util.Map;
import xyz.jwlee.poker.game.model.GameSettings;

// 엔진이 받는 모든 명령의 종류를 정의한다
/** One record per command; a null {@code playerId} means the current actor, as in TS. */
public sealed interface GameCommand {
    // 토너먼트를 시작하는 명령
    record StartTournament() implements GameCommand {}

    // 설정 단계에서 설정과 좌석 순서를 바꾸는 명령
    /** {@code order} (nullable) is the new seat order as player ids. */
    record SetupUpdate(GameSettings settings, List<String> order) implements GameCommand {}

    // 체크 명령
    record Check(String playerId) implements GameCommand {}

    // 콜 명령
    record Call(String playerId) implements GameCommand {}

    // 폴드 명령
    record Fold(String playerId) implements GameCommand {}

    // 올인 명령
    record AllIn(String playerId) implements GameCommand {}

    // 벳 명령
    record Bet(int additional, String playerId) implements GameCommand {}

    // 레이즈 명령
    record Raise(int additional, String playerId) implements GameCommand {}

    // 팟별 승자를 정해 핸드를 정산하는 명령
    /** Winner player ids per pot id. */
    record SettleHand(Map<String, List<String>> winners) implements GameCommand {}

    // 다음 핸드의 블라인드를 예약하는 명령
    record ScheduleBlinds(int smallBlind, int bigBlind) implements GameCommand {}

    // 직전 행동을 되돌리는 명령
    record Undo() implements GameCommand {}

    // 토너먼트를 중단하는 명령
    record Abort() implements GameCommand {}

    // 플레이어를 기권시키는 명령
    /** {@code byHost} marks a forfeit the host made for another player. */
    record Forfeit(String playerId, boolean byHost) implements GameCommand {}
}
