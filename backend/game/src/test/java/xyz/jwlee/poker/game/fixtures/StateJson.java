package xyz.jwlee.poker.game.fixtures;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import xyz.jwlee.poker.game.command.GameCommand;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.Blinds;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.UndoSnapshot;

/**
 * Converts the shared fixtures' TS-named JSON to and from the Java model. This is the only place
 * that knows the TS-name to Java-name mapping (B/H, actedAt/reopenAt, W/R, sb/bb, ...).
 */
public final class StateJson {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private StateJson() {}

    // ---- state ----

    public static GameState read(JsonNode n) {
        GameState s = new GameState();
        s.tournamentId = n.get("tournamentId").asText();
        s.version = n.get("version").asInt();
        s.status = TournamentStatus.valueOf(n.get("status").asText().toUpperCase(Locale.ROOT));
        s.settings = readSettings(n.get("settings"));
        s.initialTotal = n.get("initialTotal").asInt();
        s.setupOrder = present(n, "setupOrder") ? strings(n.get("setupOrder")) : null;
        s.players = new ArrayList<>();
        n.get("players").forEach(p -> s.players.add(readPlayer(p)));
        s.hand = present(n, "hand") ? readHand(n.get("hand")) : null;
        s.pot = n.get("pot").asInt();
        s.pendingBlinds = present(n, "pendingBlinds")
                ? new Blinds(n.get("pendingBlinds").get("sb").asInt(), n.get("pendingBlinds").get("bb").asInt())
                : null;
        if (present(n, "undo")) {
            // The TS snapshot is the flat state minus "undo", plus optional eventIds.
            JsonNode u = n.get("undo");
            s.undo = new UndoSnapshot(read(u), present(u, "eventIds") ? strings(u.get("eventIds")) : null);
        }
        return s;
    }

    public static JsonNode write(GameState s) {
        ObjectNode n = F.objectNode();
        n.put("tournamentId", s.tournamentId);
        n.put("version", s.version);
        n.put("status", s.status.name().toLowerCase(Locale.ROOT));
        n.set("settings", writeSettings(s.settings));
        n.put("initialTotal", s.initialTotal);
        if (s.setupOrder != null) {
            n.set("setupOrder", stringArray(s.setupOrder));
        }
        ArrayNode players = n.putArray("players");
        s.players.forEach(p -> players.add(writePlayer(p)));
        n.set("hand", s.hand == null ? F.nullNode() : writeHand(s.hand));
        n.put("pot", s.pot);
        if (s.pendingBlinds == null) {
            n.putNull("pendingBlinds");
        } else {
            ObjectNode b = n.putObject("pendingBlinds");
            b.put("sb", s.pendingBlinds.smallBlind());
            b.put("bb", s.pendingBlinds.bigBlind());
        }
        if (s.undo == null) {
            n.putNull("undo");
        } else {
            ObjectNode u = (ObjectNode) write(s.undo.state());
            u.remove("undo");
            if (s.undo.eventIds() != null) {
                u.set("eventIds", stringArray(s.undo.eventIds()));
            }
            n.set("undo", u);
        }
        return n;
    }

    public static GameSettings readSettings(JsonNode n) {
        return new GameSettings(
                strings(n.get("names")),
                n.get("initial").asInt(),
                n.get("sb").asInt(),
                n.get("bb").asInt(),
                n.get("button").asInt());
    }

    private static ObjectNode writeSettings(GameSettings g) {
        ObjectNode n = F.objectNode();
        n.set("names", stringArray(g.names()));
        n.put("initial", g.initial());
        n.put("sb", g.smallBlind());
        n.put("bb", g.bigBlind());
        n.put("button", g.button());
        return n;
    }

    private static Player readPlayer(JsonNode n) {
        Player p = new Player();
        p.id = n.get("id").asText();
        p.name = n.get("name").asText();
        p.stack = n.get("stack").asInt();
        p.eliminated = n.get("eliminated").asBoolean();
        p.folded = n.get("folded").asBoolean();
        // Server-only field: absent in TS states, so absent means false and false is not written.
        p.forfeited = present(n, "forfeited") && n.get("forfeited").asBoolean();
        p.roundBet = n.get("B").asInt();
        p.handTotal = n.get("H").asInt();
        p.actedAtBet = present(n, "actedAt") ? n.get("actedAt").asInt() : null;
        p.reopensAt = n.get("reopenAt").asInt();
        return p;
    }

    public static ObjectNode writePlayer(Player p) {
        ObjectNode n = F.objectNode();
        n.put("id", p.id);
        n.put("name", p.name);
        n.put("stack", p.stack);
        n.put("eliminated", p.eliminated);
        n.put("folded", p.folded);
        if (p.forfeited) {
            n.put("forfeited", true);
        }
        n.put("B", p.roundBet);
        n.put("H", p.handTotal);
        if (p.actedAtBet == null) {
            n.putNull("actedAt");
        } else {
            n.put("actedAt", p.actedAtBet);
        }
        n.put("reopenAt", p.reopensAt);
        return n;
    }

    private static Hand readHand(JsonNode n) {
        Hand h = new Hand();
        h.id = n.get("id").asText();
        h.number = n.get("number").asInt();
        h.street = n.get("street").asInt();
        h.phase = Phase.valueOf(n.get("phase").asText().toUpperCase(Locale.ROOT));
        h.buttonSeat = n.get("buttonSeat").asInt();
        h.sbSeat = n.get("sbSeat").asInt();
        h.bbSeat = n.get("bbSeat").asInt();
        h.smallBlind = n.get("sb").asInt();
        h.bigBlind = n.get("bb").asInt();
        h.actorId = present(n, "actorId") ? n.get("actorId").asText() : null;
        h.currentBet = n.get("W").asInt();
        h.minRaise = n.get("R").asInt();
        h.pending = strings(n.get("pending"));
        h.showdown = n.get("showdown").asBoolean();
        return h;
    }

    private static ObjectNode writeHand(Hand h) {
        ObjectNode n = F.objectNode();
        n.put("id", h.id);
        n.put("number", h.number);
        n.put("street", h.street);
        n.put("phase", h.phase.name().toLowerCase(Locale.ROOT));
        n.put("buttonSeat", h.buttonSeat);
        n.put("sbSeat", h.sbSeat);
        n.put("bbSeat", h.bbSeat);
        n.put("sb", h.smallBlind);
        n.put("bb", h.bigBlind);
        if (h.actorId == null) {
            n.putNull("actorId");
        } else {
            n.put("actorId", h.actorId);
        }
        n.put("W", h.currentBet);
        n.put("R", h.minRaise);
        n.set("pending", stringArray(h.pending));
        n.put("showdown", h.showdown);
        return n;
    }

    // ---- commands ----

    public static GameCommand command(JsonNode n) {
        String player = present(n, "playerId") ? n.get("playerId").asText() : null;
        return switch (n.get("type").asText()) {
            case "START_TOURNAMENT" -> new GameCommand.StartTournament();
            case "SETUP_UPDATE" -> new GameCommand.SetupUpdate(
                    readSettings(n.get("settings")), present(n, "order") ? strings(n.get("order")) : null);
            case "CHECK" -> new GameCommand.Check(player);
            case "CALL" -> new GameCommand.Call(player);
            case "FOLD" -> new GameCommand.Fold(player);
            case "ALL_IN" -> new GameCommand.AllIn(player);
            case "BET" -> new GameCommand.Bet(n.get("additional").asInt(), player);
            case "RAISE" -> new GameCommand.Raise(n.get("additional").asInt(), player);
            case "SETTLE_HAND" -> new GameCommand.SettleHand(winners(n.get("winners")));
            case "SCHEDULE_BLINDS" -> new GameCommand.ScheduleBlinds(n.get("sb").asInt(), n.get("bb").asInt());
            case "UNDO" -> new GameCommand.Undo();
            case "ABORT" -> new GameCommand.Abort();
            case "FORFEIT" -> new GameCommand.Forfeit(player);
            default -> throw new IllegalArgumentException("Unknown command type: " + n.get("type").asText());
        };
    }

    private static Map<String, List<String>> winners(JsonNode n) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        n.properties().forEach(e -> out.put(e.getKey(), strings(e.getValue())));
        return out;
    }

    // ---- events ----

    public static JsonNode event(GameEvent e) {
        ObjectNode n = F.objectNode();
        n.put("id", e.id());
        n.put("at", e.at());
        n.put("tournamentId", e.tournamentId());
        n.put("hand", e.hand());
        n.put("type", e.type());
        n.set("details", details(e.details()));
        return n;
    }

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
                    n.set("eventIds", stringArray(x.eventIds()));
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

    // ---- helpers ----

    private static boolean present(JsonNode n, String key) {
        JsonNode v = n.get(key);
        return v != null && !v.isNull();
    }

    private static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        arr.forEach(x -> out.add(x.asText()));
        return out;
    }

    private static ArrayNode stringArray(List<String> list) {
        ArrayNode a = F.arrayNode();
        list.forEach(a::add);
        return a;
    }
}
