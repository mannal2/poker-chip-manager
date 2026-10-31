package xyz.jwlee.poker.gamejson;

import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;

// 게임 이벤트를 TypeScript 게임 이벤트 모델과 같은 필드 구조의 JSON으로 변환한다
/**
 * Writes game events as TS-shaped JSON: {@code {id, at, tournamentId, hand, type, details}}. The
 * details match the TS {@code emit} arguments; FORFEIT and FORFEIT_SPLIT exist on the server only.
 */
public final class EventJson {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private EventJson() {}

    // 이벤트의 식별자, 시각, 토너먼트 ID, 핸드 번호, 종류, 상세 내용을 JSON 객체로 만든다
    public static ObjectNode write(GameEvent e) {
        ObjectNode n = F.objectNode();
        n.put("id", e.id());
        n.put("at", e.at());
        n.put("tournamentId", e.tournamentId());
        n.put("hand", e.hand());
        n.put("type", e.type());
        n.set("details", details(e.details()));
        return n;
    }

    // 이벤트 종류별 상세 내용을 JSON 객체로 만든다
    private static ObjectNode details(EventDetails d) {
        ObjectNode n = F.objectNode();
        switch (d) {
            case EventDetails.HandStarted x -> {
                n.put("buttonSeat", x.buttonSeat());
                n.put("sbSeat", x.sbSeat());
                n.put("bbSeat", x.bbSeat());
                n.put("sb", x.smallBlind());
                n.put("bb", x.bigBlind());
            }
            case EventDetails.PlayerActed x -> {
                n.put("playerId", x.playerId());
                n.put("additional", x.additional());
            }
            case EventDetails.UncalledReturned x -> {
                n.put("playerId", x.playerId());
                n.put("amount", x.amount());
            }
            case EventDetails.RoundClosed x -> n.put("showdown", x.showdown());
            case EventDetails.StreetStarted x -> n.put("street", x.street());
            case EventDetails.PotsPaid x -> {
                n.put("pot", x.pot());
                ObjectNode payouts = n.putObject("payouts");
                x.payouts().forEach(payouts::put);
            }
            case EventDetails.PlayerEliminated x -> n.put("playerId", x.playerId());
            case EventDetails.TournamentEnded x -> n.put("winner", x.winner());
            case EventDetails.BlindsScheduled x -> {
                n.put("sb", x.smallBlind());
                n.put("bb", x.bigBlind());
            }
            case EventDetails.ActionUndone x -> {
                if (x.eventIds() != null) {
                    n.set("eventIds", GameJson.stringArray(x.eventIds()));
                }
            }
            case EventDetails.TournamentAborted x -> { }
            case EventDetails.PlayerForfeited x -> n.put("playerId", x.playerId());
            case EventDetails.ForfeitStackSplit x -> {
                n.put("playerId", x.playerId());
                ObjectNode shares = n.putObject("shares");
                x.shares().forEach(shares::put);
            }
        }
        return n;
    }
}
