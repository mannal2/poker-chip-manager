package xyz.jwlee.poker.game;

import java.util.LinkedHashMap;
import java.util.List;

/** How one pot is split; {@code payouts} is in seat order, remainder recipients in remainder order. */
public record PotAllocation(
        String potId, int amount, LinkedHashMap<String, Integer> payouts, List<String> remainderRecipients) {}
