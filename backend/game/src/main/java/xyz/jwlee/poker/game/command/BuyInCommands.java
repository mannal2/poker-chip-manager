package xyz.jwlee.poker.game.command;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import xyz.jwlee.poker.game.Round;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.FormerPlayer;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Joining;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;
import xyz.jwlee.poker.game.settings.SettingsValidator;

// 바이인과 바이인 취소 명령을 처리한다
/** BUY_IN and CANCEL_BUY_IN (TS {@code commands/buyIn.ts}). */
public final class BuyInCommands {
    /** Most seats one table holds. */
    private static final int MAX_SEATS = 10;

    private static final Pattern PLAYER_ID = Pattern.compile("^p(\\d+)$");

    private BuyInCommands() {}

    // 지금 플레이어와 이전 플레이어의 p<숫자> 중 최댓값에 1을 더한 새 id를 돌려준다
    public static String nextPlayerId(GameState s) {
        Stream<String> ids = Stream.concat(
                s.players.stream().map(p -> p.id), formerPlayers(s).stream().map(FormerPlayer::id));
        long max = ids.map(PLAYER_ID::matcher)
                .filter(Matcher::matches)
                .mapToLong(m -> Long.parseLong(m.group(1)))
                .max()
                .orElse(-1);
        return "p" + (max + 1);
    }

    // 바이인 명령을 검증해 새 플레이어를 자리에 앉히고 칩 합계를 늘린다
    public static void buyIn(GameState s, GameCommand.BuyIn cmd, TransitionContext c, List<GameEvent> events) {
        Rules.require(s.status == TournamentStatus.PLAYING);
        boolean reentry = cmd.reentryOf() != null && !cmd.reentryOf().isEmpty();
        String name;
        if (reentry) {
            // A re-entry target is an eliminated player still seated or one whose seat a newcomer took.
            Player seated = s.players.stream().filter(p -> p.id.equals(cmd.reentryOf())).findFirst().orElse(null);
            FormerPlayer former = formerPlayers(s).stream()
                    .filter(p -> p.id().equals(cmd.reentryOf()) && p.reason() == FormerPlayer.Reason.REPLACED)
                    .findFirst()
                    .orElse(null);
            Rules.require(seated != null ? seated.eliminated : former != null);
            name = seated != null ? seated.name : former.name();
        } else {
            Optional<String> normalized = SettingsValidator.normalizeName(cmd.name());
            Rules.require(normalized.isPresent(), RuleErrorCode.INVALID_NAMES);
            name = normalized.get();
        }
        String lowered = name.toLowerCase(Locale.ROOT);
        Rules.require(
                s.players.stream().noneMatch(p -> !p.eliminated && p.name.toLowerCase(Locale.ROOT).equals(lowered)),
                RuleErrorCode.INVALID_NAMES);
        BuyInPlacement placement = cmd.placement();
        int index;
        if (placement instanceof BuyInPlacement.Between between) {
            int after = indexOf(s, between.after());
            Rules.require(s.players.size() < MAX_SEATS && after >= 0, RuleErrorCode.INVALID_SEATS);
            index = after + 1;
        } else {
            Rules.require(placement instanceof BuyInPlacement.Replace, RuleErrorCode.INVALID_SEATS);
            index = indexOf(s, ((BuyInPlacement.Replace) placement).playerId());
            Rules.require(
                    index >= 0 && s.players.get(index).eliminated && s.players.get(index).joining == null,
                    RuleErrorCode.INVALID_SEATS);
        }
        // A returning person's entry follows the highest entry ever recorded under the same name;
        // cancelled buy-ins do not count.
        int entry = 1;
        if (reentry) {
            int seatedMax = s.players.stream()
                    .filter(p -> p.name.toLowerCase(Locale.ROOT).equals(lowered))
                    .mapToInt(p -> p.entry == null ? 1 : p.entry)
                    .max()
                    .orElse(1);
            int formerMax = formerPlayers(s).stream()
                    .filter(p -> p.reason() != FormerPlayer.Reason.CANCELLED
                            && p.name().toLowerCase(Locale.ROOT).equals(lowered))
                    .mapToInt(FormerPlayer::entry)
                    .max()
                    .orElse(1);
            entry = 1 + Math.max(seatedMax, formerMax);
        }
        Player player = new Player();
        player.id = nextPlayerId(s);
        player.name = name;
        player.stack = s.settings.initial();
        player.folded = true;
        player.entry = entry;
        player.joining = Joining.NEXT_HAND;
        if (placement instanceof BuyInPlacement.Between) {
            s.players.add(index, player);
            shiftSeats(s, index, 1);
        } else {
            Player old = s.players.set(index, player);
            player.replaced = old;
            List<FormerPlayer> former = new ArrayList<>(formerPlayers(s));
            former.add(new FormerPlayer(
                    old.id, old.name, old.entry == null ? 1 : old.entry, FormerPlayer.Reason.REPLACED));
            s.formerPlayers = former;
        }
        s.initialTotal += s.settings.initial();
        s.undo = null;
        Round.emit(s, c, events, new EventDetails.PlayerBoughtIn(
                player.id, entry, reentry ? cmd.reentryOf() : null, player.replaced == null ? null : player.replaced.id));
    }

    // 첫 카드 전의 바이인을 취소해 원래 자리 상태로 되돌린다
    public static void cancelBuyIn(
            GameState s, GameCommand.CancelBuyIn cmd, TransitionContext c, List<GameEvent> events) {
        Rules.require(s.status == TournamentStatus.PLAYING);
        int index = indexOf(s, cmd.playerId());
        Rules.require(index >= 0 && s.players.get(index).joining != null);
        Player joiner = s.players.get(index);
        Player replaced = joiner.replaced;
        List<FormerPlayer> former = new ArrayList<>(formerPlayers(s).stream()
                .filter(p -> replaced == null || !p.id().equals(replaced.id))
                .toList());
        if (replaced != null) {
            s.players.set(index, replaced);
        } else {
            s.players.remove(index);
            shiftSeats(s, index + 1, -1);
        }
        // Keep the cancelled id reserved so later buy-ins never reuse it in the event history.
        former.add(new FormerPlayer(
                joiner.id, joiner.name, joiner.entry == null ? 1 : joiner.entry, FormerPlayer.Reason.CANCELLED));
        s.formerPlayers = former;
        s.initialTotal -= s.settings.initial();
        s.undo = null;
        Round.emit(s, c, events, new EventDetails.BuyInCancelled(cmd.playerId()));
    }

    // 삽입 위치 이상을 가리키는 핸드 좌석 번호를 by만큼 민다
    private static void shiftSeats(GameState s, int from, int by) {
        Hand h = s.hand;
        if (h == null) {
            return;
        }
        if (h.buttonSeat >= from) {
            h.buttonSeat += by;
        }
        if (h.sbSeat >= from) {
            h.sbSeat += by;
        }
        if (h.bbSeat >= from) {
            h.bbSeat += by;
        }
    }

    // id가 같은 플레이어의 좌석 번호를 찾고 없으면 -1을 돌려준다
    private static int indexOf(GameState s, String id) {
        for (int i = 0; i < s.players.size(); i++) {
            if (s.players.get(i).id.equals(id)) {
                return i;
            }
        }
        return -1;
    }

    // 이전 플레이어 기록을 돌려주고 없으면 빈 목록을 돌려준다
    private static List<FormerPlayer> formerPlayers(GameState s) {
        return s.formerPlayers == null ? List.of() : s.formerPlayers;
    }
}
