package xyz.jwlee.poker.server.room;

import java.util.List;
import java.util.Map;

// 방장이 정산 중에 고르고 있는 승자 선택 초안
/** The host's in-progress pot settlement, shown to everyone until it is applied. */
public record SettlementDraft(long draftVersion, int potIndex, Map<String, List<String>> winners) {
    public SettlementDraft {
        winners = Map.copyOf(winners);
    }
}
