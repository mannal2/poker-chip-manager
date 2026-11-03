package xyz.jwlee.poker.game;

import java.util.LinkedHashMap;
import java.util.List;

// 팟 하나의 분배 결과(승자별 금액과 나머지 칩 수령자)를 담는다
/** How one pot is split; {@code payouts} is in seat order, remainder recipients in remainder order. */
public record PotAllocation(
        String potId, int amount, LinkedHashMap<String, Integer> payouts, List<String> remainderRecipients) {}
