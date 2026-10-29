package xyz.jwlee.poker.game;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import xyz.jwlee.poker.game.event.EventDetails;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.game.model.Blinds;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Hand;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.SeatPositions;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;

/** Hand progression shared by the command handlers: payments, rounds, streets and payouts. */
public final class Round {
    private Round() {}

    public static void pay(GameState s, int index, int amount) {
        Player p = s.players.get(index);
        p.stack -= amount;
        p.roundBet += amount;
        p.handTotal += amount;
        s.pot += amount;
    }

    /** Appends an event whose id is {@code {ctx.id}:{index within this transition}}. */
    public static void emit(GameState s, TransitionContext c, List<GameEvent> events, EventDetails details) {
        events.add(new GameEvent(
                c.id() + ":" + events.size(), c.at(), s.tournamentId, s.hand == null ? 0 : s.hand.number, details));
    }

    /** Gives the unmatched part of the highest round bet back; null when nothing is uncalled. */
    public static EventDetails.UncalledReturned returnUncalled(GameState s) {
        List<Player> sorted = new ArrayList<>(s.players);
        sorted.sort((a, b) -> Integer.compare(b.roundBet, a.roundBet)); // stable, like TS sort
        if (sorted.get(0).roundBet <= sorted.get(1).roundBet) {
            return null;
        }
        Player p = sorted.get(0);
        int amount = p.roundBet - sorted.get(1).roundBet;
        p.stack += amount;
        p.roundBet -= amount;
        p.handTotal -= amount;
        s.pot -= amount;
        return new EventDetails.UncalledReturned(p.id, amount);
    }

    public static void resolveRound(GameState s, int after, TransitionContext c, List<GameEvent> events) {
        Hand h = s.hand;
        List<Player> live = s.players.stream().filter(p -> !p.folded && !p.eliminated).toList();
        List<Player> able = live.stream().filter(p -> p.stack > 0).toList();
        h.pending = new ArrayList<>(
                h.pending.stream().filter(id -> able.stream().anyMatch(p -> p.id.equals(id))).toList());
        if (able.size() == 1) {
            Player p = able.get(0);
            int maxOther = live.stream().filter(o -> o != p).mapToInt(o -> o.roundBet).max().orElse(0);
            h.pending = p.roundBet < maxOther ? new ArrayList<>(List.of(p.id)) : new ArrayList<>();
        }
        if (live.size() == 1) {
            EventDetails.UncalledReturned returned = returnUncalled(s);
            if (returned != null) {
                emit(s, c, events, returned);
            }
            Map<String, List<String>> winners = new LinkedHashMap<>();
            for (var pot : Settlement.buildPots(s)) {
                winners.put(pot.id(), List.of(live.get(0).id));
            }
            settle(s, winners, c, events);
            return;
        }
        if (!h.pending.isEmpty()) {
            boolean[] waiting = new boolean[s.players.size()];
            for (int i = 0; i < waiting.length; i++) {
                waiting[i] = h.pending.contains(s.players.get(i).id);
            }
            h.actorId = s.players.get(Positions.nextSeat(after, waiting)).id;
            return;
        }
        finishRound(s, c, events);
    }

    public static void advanceStreet(GameState s, TransitionContext c, List<GameEvent> events) {
        Hand h = s.hand;
        h.street++;
        h.currentBet = 0;
        h.minRaise = h.bigBlind;
        h.phase = Phase.BETTING;
        for (Player p : s.players) {
            p.roundBet = 0;
            p.actedAtBet = null;
            p.reopensAt = 0;
        }
        h.pending = new ArrayList<>(s.players.stream()
                .filter(p -> !p.folded && !p.eliminated && p.stack > 0)
                .map(p -> p.id)
                .toList());
        emit(s, c, events, new EventDetails.StreetStarted(h.street));
        resolveRound(s, h.buttonSeat, c, events);
    }

    public static void finishRound(GameState s, TransitionContext c, List<GameEvent> events) {
        Hand h = s.hand;
        EventDetails.UncalledReturned returned = returnUncalled(s);
        if (returned != null) {
            emit(s, c, events, returned);
        }
        h.actorId = null;
        h.showdown = h.street == 3
                || s.players.stream().filter(p -> !p.folded && !p.eliminated && p.stack > 0).count() <= 1;
        s.undo = null;
        emit(s, c, events, new EventDetails.RoundClosed(h.showdown));
        if (h.showdown) {
            h.phase = Phase.SETTLEMENT;
        } else {
            advanceStreet(s, c, events);
        }
    }

    public static void startHand(GameState s, TransitionContext c, List<GameEvent> events) {
        Hand previous = s.hand;
        boolean[] alive = new boolean[s.players.size()];
        for (int i = 0; i < alive.length; i++) {
            alive[i] = !s.players.get(i).eliminated;
        }
        SeatPositions position;
        if (previous != null) {
            position = Positions.nextPositions(
                    alive, new SeatPositions(previous.buttonSeat, previous.sbSeat, previous.bbSeat));
        } else {
            var seats = Positions.initialBlindSeats(s.settings.button(), alive);
            position = new SeatPositions(s.settings.button(), seats.sbSeat(), seats.bbSeat());
        }
        Blinds blinds = s.pendingBlinds != null
                ? s.pendingBlinds
                : previous != null
                        ? new Blinds(previous.smallBlind, previous.bigBlind)
                        : new Blinds(s.settings.smallBlind(), s.settings.bigBlind());
        s.pendingBlinds = null;
        for (Player p : s.players) {
            p.roundBet = 0;
            p.handTotal = 0;
            p.folded = false;
            p.actedAtBet = null;
            p.reopensAt = 0;
        }
        s.pot = 0;
        s.undo = null;
        int number = (previous == null ? 0 : previous.number) + 1;
        Hand h = new Hand();
        h.id = c.id() + ":hand:" + number;
        h.number = number;
        h.street = 0;
        h.phase = Phase.BETTING;
        h.buttonSeat = position.buttonSeat();
        h.sbSeat = position.sbSeat();
        h.bbSeat = position.bbSeat();
        h.smallBlind = blinds.smallBlind();
        h.bigBlind = blinds.bigBlind();
        h.actorId = null;
        h.currentBet = blinds.bigBlind();
        h.minRaise = blinds.bigBlind();
        h.pending = new ArrayList<>(s.players.stream()
                .filter(p -> !p.eliminated && p.stack > 0)
                .map(p -> p.id)
                .toList());
        h.showdown = false;
        s.hand = h;
        if (alive[position.sbSeat()]) {
            pay(s, position.sbSeat(), Math.min(s.players.get(position.sbSeat()).stack, blinds.smallBlind()));
        }
        if (alive[position.bbSeat()]) {
            pay(s, position.bbSeat(), Math.min(s.players.get(position.bbSeat()).stack, blinds.bigBlind()));
        }
        emit(s, c, events, new EventDetails.HandStarted(
                position.buttonSeat(), position.sbSeat(), position.bbSeat(), blinds.smallBlind(), blinds.bigBlind()));
        resolveRound(s, position.bbSeat(), c, events);
    }

    public static void settle(
            GameState s, Map<String, List<String>> winners, TransitionContext c, List<GameEvent> events) {
        SettlementPreview preview = Settlement.preview(s, winners);
        Rules.require(preview.ok(), preview.ok() ? RuleErrorCode.INVALID_ACTION : RuleErrorCode.valueOf(preview.error().name()));
        emit(s, c, events, new EventDetails.PotsPaid(s.pot, preview.payouts()));
        for (Player p : s.players) {
            p.stack += preview.payouts().get(p.id);
            p.roundBet = 0;
            p.handTotal = 0;
        }
        splitForfeitedStacks(s, c, events);
        for (Player p : s.players) {
            if (p.stack == 0 && !p.eliminated) {
                p.eliminated = true;
                emit(s, c, events, new EventDetails.PlayerEliminated(p.id));
            }
        }
        s.pot = 0;
        s.undo = null;
        List<Player> remaining = s.players.stream().filter(p -> !p.eliminated).toList();
        if (remaining.size() == 1) {
            s.status = TournamentStatus.ENDED;
            s.hand.actorId = null;
            s.hand.phase = Phase.SETTLEMENT;
            emit(s, c, events, new EventDetails.TournamentEnded(remaining.get(0).id));
        } else {
            startHand(s, c, events);
        }
    }

    /**
     * After the payouts, each forfeited player's stack goes to the survivors in 5-chip units; the
     * leftover units go one each from the seat after the button. The emptied stack is then
     * eliminated by the normal rule.
     */
    private static void splitForfeitedStacks(GameState s, TransitionContext c, List<GameEvent> events) {
        int count = s.players.size();
        int button = s.hand.buttonSeat;
        for (Player f : s.players) {
            if (!f.forfeited || f.eliminated || f.stack == 0) {
                continue;
            }
            List<Player> survivors = new ArrayList<>(s.players.stream()
                    .filter(p -> !p.eliminated && !p.forfeited && p.stack > 0)
                    .toList());
            if (survivors.isEmpty()) {
                throw new IllegalStateException("NO_FORFEIT_SURVIVOR");
            }
            survivors.sort((a, b) -> Integer.compare(
                    (s.players.indexOf(a) - button - 1 + count) % count,
                    (s.players.indexOf(b) - button - 1 + count) % count));
            int units = f.stack / 5;
            int share = units / survivors.size();
            int remainder = units % survivors.size();
            Map<String, Integer> byId = new LinkedHashMap<>();
            for (int k = 0; k < survivors.size(); k++) {
                byId.put(survivors.get(k).id, (share + (k < remainder ? 1 : 0)) * 5);
            }
            LinkedHashMap<String, Integer> shares = new LinkedHashMap<>();
            for (Player p : s.players) {
                Integer amount = byId.get(p.id);
                if (amount != null) {
                    p.stack += amount;
                    shares.put(p.id, amount);
                }
            }
            f.stack = 0;
            emit(s, c, events, new EventDetails.ForfeitStackSplit(f.id, shares));
        }
    }
}
