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
import xyz.jwlee.poker.game.model.Joining;
import xyz.jwlee.poker.game.model.Phase;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.SeatPositions;
import xyz.jwlee.poker.game.model.TournamentStatus;
import xyz.jwlee.poker.game.model.TransitionContext;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.Rules;

// 칩 지불, 라운드/스트리트 진행, 핸드 시작과 정산 등 핸드 진행 로직을 모은다
/** Hand progression shared by the command handlers: payments, rounds, streets and payouts. */
public final class Round {
    private Round() {}

    // 플레이어의 스택에서 팟으로 칩을 옮겨 베팅 기록에 반영한다
    public static void pay(GameState s, int index, int amount) {
        Player p = s.players.get(index);
        p.stack -= amount;
        p.roundBet += amount;
        p.handTotal += amount;
        s.pot += amount;
    }

    // 이벤트 목록에 새 이벤트를 추가한다
    /** Appends an event whose id is {@code {ctx.id}:{index within this transition}}. */
    public static void emit(GameState s, TransitionContext c, List<GameEvent> events, EventDetails details) {
        events.add(new GameEvent(
                c.id() + ":" + events.size(), c.at(), s.tournamentId, s.hand == null ? 0 : s.hand.number, details));
    }

    // 현재 라운드의 최고 베팅액 중 두 번째로 높은 베팅액을 초과한 금액을 베팅한 플레이어에게 돌려준다
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

    // 기권 처리 후 팟을 받을 자격이 있는 플레이어가 없는 납부 구간의 칩을 각 납부자에게 돌려준다
    /**
     * Server only (forfeits): contribution layers above the highest live contribution have nobody
     * left who could win them, because every player who reached them folded. Each contributor gets
     * back exactly what they put into those layers (a forfeiter's share is split with the stack
     * after the hand), one RETURN per player in seat order. Called wherever a round closes, so no
     * state that reaches {@link Settlement#buildPots} or {@link #settle} has an ownerless layer.
     * Without forfeits (TS) every layer keeps a live contributor and this does nothing.
     */
    public static void returnOwnerless(GameState s, TransitionContext c, List<GameEvent> events) {
        int cap = s.players.stream()
                .filter(p -> !p.folded && !p.eliminated)
                .mapToInt(p -> p.handTotal)
                .max()
                .orElseThrow();
        for (Player p : s.players) {
            if (p.handTotal > cap) {
                int amount = p.handTotal - cap;
                p.handTotal = cap;
                p.roundBet = Math.min(p.roundBet, cap);
                p.stack += amount;
                s.pot -= amount;
                emit(s, c, events, new EventDetails.UncalledReturned(p.id, amount));
            }
        }
    }

    // 행동 후 다음 차례를 정하거나 라운드 종료/단독 승리를 처리한다
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
            returnOwnerless(s, c, events);
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

    // 다음 스트리트로 넘어가며 라운드 베팅 상태를 초기화한다
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

    // 베팅 라운드를 마감하고 쇼다운 또는 다음 스트리트로 진행한다
    public static void finishRound(GameState s, TransitionContext c, List<GameEvent> events) {
        Hand h = s.hand;
        EventDetails.UncalledReturned returned = returnUncalled(s);
        if (returned != null) {
            emit(s, c, events, returned);
        }
        returnOwnerless(s, c, events);
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

    // 헤즈업 직후 세 명 이상이 되면 이전 BB 다음 자리를 BB로 두고 거꾸로 SB와 버튼을 정한다
    private static SeatPositions positionsAfterHeadsUp(boolean[] alive, Hand previous) {
        int bbSeat = Positions.nextSeat(previous.bbSeat, alive);
        int sbSeat = seatBefore(bbSeat, alive);
        return new SeatPositions(seatBefore(sbSeat, alive), sbSeat, bbSeat);
    }

    // 기준 좌석의 앞자리부터 거꾸로 돌며 참가 자격이 있는 첫 좌석을 찾는다
    private static int seatBefore(int seat, boolean[] alive) {
        for (int k = 1; k <= alive.length; k++) {
            int i = (seat - k + alive.length) % alive.length;
            if (alive[i]) {
                return i;
            }
        }
        throw new IllegalStateException("NO_ELIGIBLE_SEAT");
    }

    // 버튼과 블라인드 위치를 이전 핸드(없으면 설정의 버튼)에서 계산한다
    private static SeatPositions positionsFrom(GameState s, Hand previous, boolean[] alive) {
        if (previous == null) {
            var seats = Positions.initialBlindSeats(s.settings.button(), alive);
            return new SeatPositions(s.settings.button(), seats.sbSeat(), seats.bbSeat());
        }
        return Positions.nextPositions(alive, new SeatPositions(previous.buttonSeat, previous.sbSeat, previous.bbSeat));
    }

    // 카드를 받는 자리 집합으로 이번 핸드 위치를 계산한다(헤즈업에서 세 명 이상이 되면 따로 계산)
    private static SeatPositions positionsWithJoiners(GameState s, Hand previous, boolean[] alive) {
        boolean headsUp = previous != null && previous.buttonSeat == previous.sbSeat;
        return headsUp && Positions.aliveCount(alive) >= 3
                ? positionsAfterHeadsUp(alive, previous)
                : positionsFrom(s, previous, alive);
    }

    // 대기자를 참여시킬지 정하고 이번 핸드에 카드를 받는 사람 기준으로 위치를 계산한다
    private static SeatPositions seatJoiners(GameState s, Hand previous) {
        int size = s.players.size();
        boolean[] playing = new boolean[size];
        List<Integer> joiners = new ArrayList<>();
        for (int i = 0; i < size; i++) {
            Player p = s.players.get(i);
            playing[i] = !p.eliminated && p.joining == null;
            if (p.joining != null) {
                joiners.add(i);
            }
        }
        if (joiners.isEmpty()) {
            return positionsFrom(s, previous, playing);
        }
        if (Positions.aliveCount(playing) < 2) {
            joiners.forEach(i -> dealIn(s.players.get(i)));
            return positionsWithJoiners(s, previous, dealt(s));
        }
        // Drop joiners strictly between the button and the SB, recomputing until the positions settle.
        List<Integer> candidates = joiners;
        SeatPositions position;
        while (true) {
            boolean[] alive = playing.clone();
            candidates.forEach(i -> alive[i] = true);
            SeatPositions computed = positionsWithJoiners(s, previous, alive);
            position = computed;
            List<Integer> kept = candidates.stream()
                    .filter(i -> !Positions.isBetweenButtonAndSb(i, computed.buttonSeat(), computed.sbSeat(), size))
                    .toList();
            if (kept.size() == candidates.size()) {
                break;
            }
            candidates = kept;
        }
        for (int i : joiners) {
            if (candidates.contains(i)) {
                dealIn(s.players.get(i));
            } else {
                s.players.get(i).joining = Joining.BUTTON;
            }
        }
        return position;
    }

    // 대기자를 이번 핸드에 참여시킨다
    private static void dealIn(Player p) {
        p.joining = null;
        p.replaced = null;
    }

    // 이번 핸드에 카드를 받는 좌석(탈락하지 않고 기다리지 않는 사람)을 표시한다
    private static boolean[] dealt(GameState s) {
        boolean[] alive = new boolean[s.players.size()];
        for (int i = 0; i < alive.length; i++) {
            alive[i] = !s.players.get(i).eliminated && s.players.get(i).joining == null;
        }
        return alive;
    }

    // 새 핸드를 만들고 블라인드를 낸 뒤 첫 차례를 정한다
    public static void startHand(GameState s, TransitionContext c, List<GameEvent> events) {
        Hand previous = s.hand;
        SeatPositions position = seatJoiners(s, previous);
        boolean[] alive = dealt(s);
        Blinds blinds = s.pendingBlinds != null
                ? s.pendingBlinds
                : previous != null
                        ? new Blinds(previous.smallBlind, previous.bigBlind)
                        : new Blinds(s.settings.smallBlind(), s.settings.bigBlind());
        s.pendingBlinds = null;
        for (Player p : s.players) {
            p.roundBet = 0;
            p.handTotal = 0;
            p.folded = p.joining != null;
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
        h.pending = new ArrayList<>();
        for (int i = 0; i < alive.length; i++) {
            if (alive[i] && s.players.get(i).stack > 0) {
                h.pending.add(s.players.get(i).id);
            }
        }
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

    // 선택된 승자에게 팟을 지급하고 탈락 처리 후 다음 핸드 또는 종료로 이어간다
    public static void settle(
            GameState s, Map<String, List<String>> winners, TransitionContext c, List<GameEvent> events) {
        LinkedHashMap<String, Integer> payouts;
        if (s.pot == 0) {
            // Everything went back (e.g. dead small blind, all fold to the big blind): nothing to
            // select, but PAYOUT still marks the end of the hand.
            payouts = new LinkedHashMap<>();
            for (Player p : s.players) {
                payouts.put(p.id, 0);
            }
        } else {
            SettlementPreview preview = Settlement.preview(s, winners);
            Rules.require(preview.ok(), preview.ok() ? RuleErrorCode.INVALID_ACTION : RuleErrorCode.valueOf(preview.error().name()));
            payouts = preview.payouts();
        }
        emit(s, c, events, new EventDetails.PotsPaid(s.pot, payouts));
        for (Player p : s.players) {
            p.stack += payouts.get(p.id);
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

    // 기권한 플레이어의 남은 스택을 생존자에게 나눠 준다
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
