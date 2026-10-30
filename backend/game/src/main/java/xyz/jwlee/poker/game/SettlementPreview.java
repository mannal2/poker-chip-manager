package xyz.jwlee.poker.game;

import java.util.LinkedHashMap;
import java.util.List;
import xyz.jwlee.poker.game.rule.SettlementErrorCode;

/** Result of previewing a winner selection; {@code error}/{@code allocations} are null when not applicable. */
public record SettlementPreview(
        boolean ok,
        LinkedHashMap<String, Integer> payouts,
        SettlementErrorCode error,
        List<PotAllocation> allocations) {}
