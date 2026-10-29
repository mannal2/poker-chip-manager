package xyz.jwlee.poker.game;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import xyz.jwlee.poker.game.model.GameState;
import xyz.jwlee.poker.game.model.Player;
import xyz.jwlee.poker.game.model.Pot;
import xyz.jwlee.poker.game.rule.SettlementErrorCode;

/** Pot construction and winner-selection validation (TS {@code settlement.ts}). */
public final class Settlement {
    private Settlement() {}

    public static List<Pot> buildPots(GameState s) {
        List<Integer> heights = s.players.stream()
                .map(p -> p.handTotal)
                .filter(n -> n > 0)
                .distinct()
                .sorted()
                .toList();
        int previous = 0;
        List<Pot> pots = new ArrayList<>();
        for (int height : heights) {
            List<Player> contributors =
                    s.players.stream().filter(p -> p.handTotal >= height).toList();
            List<String> eligible = contributors.stream()
                    .filter(p -> !p.folded && !p.eliminated)
                    .map(p -> p.id)
                    .toList();
            int amount = (height - previous) * contributors.size();
            previous = height;
            if (eligible.isEmpty()) {
                throw new IllegalStateException("NO_POT_ELIGIBLE");
            }
            Pot last = pots.isEmpty() ? null : pots.get(pots.size() - 1);
            // Folded contributions add money, but cannot create a new winner eligibility boundary.
            if (last != null && last.eligible().equals(eligible)) {
                pots.set(pots.size() - 1, new Pot(last.id(), last.amount() + amount, last.eligible()));
            } else {
                pots.add(new Pot("pot" + pots.size(), amount, eligible));
            }
        }
        return pots;
    }

    public static SettlementPreview preview(GameState s, Map<String, List<String>> winners) {
        return preview(s, winners, buildPots(s));
    }

    public static SettlementPreview preview(GameState s, Map<String, List<String>> winners, List<Pot> pots) {
        LinkedHashMap<String, Integer> payouts = new LinkedHashMap<>();
        for (Player p : s.players) {
            payouts.put(p.id, 0);
        }
        if (pots.isEmpty()) {
            return fail(payouts, SettlementErrorCode.NO_POT);
        }
        List<List<String>> selected = new ArrayList<>();
        for (Pot pot : pots) {
            List<String> chosen = winners.get(pot.id());
            selected.add(chosen != null ? chosen : pot.eligible().size() == 1 ? pot.eligible() : List.of());
        }
        for (int i = 0; i < pots.size(); i++) {
            List<String> ids = selected.get(i);
            Pot pot = pots.get(i);
            if (ids.isEmpty()
                    || new HashSet<>(ids).size() != ids.size()
                    || ids.stream().anyMatch(id -> !pot.eligible().contains(id))) {
                return fail(payouts, SettlementErrorCode.WINNER_REQUIRED);
            }
        }
        // Players tied in a pot are merged into one group; ordering constraints between groups must
        // stay consistent (no group both beats and loses to the same group, directly or in a cycle).
        Map<String, String> parent = new HashMap<>();
        for (Player p : s.players) {
            parent.put(p.id, p.id);
        }
        for (List<String> ids : selected) {
            for (String id : ids.subList(1, ids.size())) {
                String from = find(parent, id);
                String to = find(parent, ids.get(0));
                parent.put(from, to);
            }
        }
        Map<String, Set<String>> edges = new LinkedHashMap<>();
        for (int i = 0; i < pots.size(); i++) {
            String winner = find(parent, selected.get(i).get(0));
            for (String loser : pots.get(i).eligible()) {
                if (selected.get(i).contains(loser)) {
                    continue;
                }
                String to = find(parent, loser);
                if (winner.equals(to)) {
                    return fail(payouts, SettlementErrorCode.TIE_CONFLICT);
                }
                edges.computeIfAbsent(winner, k -> new LinkedHashSet<>()).add(to);
            }
        }
        Set<String> visiting = new HashSet<>();
        Set<String> visited = new HashSet<>();
        for (String id : edges.keySet()) {
            if (hasCycle(edges, id, visiting, visited)) {
                return fail(payouts, SettlementErrorCode.POT_ORDER_CONFLICT);
            }
        }
        List<PotAllocation> allocations = new ArrayList<>();
        for (int i = 0; i < pots.size(); i++) {
            Pot pot = pots.get(i);
            int button = s.hand.buttonSeat;
            int count = s.players.size();
            // Remainder chips go to the winners closest after the button.
            List<String> order = new ArrayList<>(selected.get(i));
            order.sort((a, b) -> Integer.compare(rank(s, a, button, count), rank(s, b, button, count)));
            int units = pot.amount() / 5;
            int share = units / order.size();
            int remainder = units % order.size();
            Map<String, Integer> byId = new HashMap<>();
            for (int k = 0; k < order.size(); k++) {
                byId.put(order.get(k), (share + (k < remainder ? 1 : 0)) * 5);
            }
            LinkedHashMap<String, Integer> perPot = new LinkedHashMap<>();
            for (Player p : s.players) {
                Integer amount = byId.get(p.id);
                if (amount != null) {
                    perPot.put(p.id, amount);
                    payouts.merge(p.id, amount, Integer::sum);
                }
            }
            allocations.add(new PotAllocation(pot.id(), pot.amount(), perPot, List.copyOf(order.subList(0, remainder))));
        }
        return new SettlementPreview(true, payouts, null, allocations);
    }

    private static int rank(GameState s, String id, int button, int count) {
        int seat = 0;
        for (int i = 0; i < s.players.size(); i++) {
            if (s.players.get(i).id.equals(id)) {
                seat = i;
                break;
            }
        }
        return (seat - button - 1 + count) % count;
    }

    private static String find(Map<String, String> parent, String id) {
        String p = parent.get(id);
        if (p.equals(id)) {
            return id;
        }
        String root = find(parent, p);
        parent.put(id, root);
        return root;
    }

    private static boolean hasCycle(
            Map<String, Set<String>> edges, String id, Set<String> visiting, Set<String> visited) {
        if (visiting.contains(id)) {
            return true;
        }
        if (visited.contains(id)) {
            return false;
        }
        visiting.add(id);
        for (String to : edges.getOrDefault(id, Set.of())) {
            if (hasCycle(edges, to, visiting, visited)) {
                return true;
            }
        }
        visiting.remove(id);
        visited.add(id);
        return false;
    }

    private static SettlementPreview fail(LinkedHashMap<String, Integer> payouts, SettlementErrorCode error) {
        return new SettlementPreview(false, payouts, error, null);
    }
}
