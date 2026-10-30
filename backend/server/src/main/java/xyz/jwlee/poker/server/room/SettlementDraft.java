package xyz.jwlee.poker.server.room;

import java.util.List;
import java.util.Map;

/** The host's in-progress pot settlement, shown to everyone until it is applied. */
public record SettlementDraft(long draftVersion, int potIndex, Map<String, List<String>> winners) {
    public SettlementDraft {
        winners = Map.copyOf(winners);
    }
}
