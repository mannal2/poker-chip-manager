package xyz.jwlee.poker.game;

import java.util.LinkedHashMap;
import java.util.List;
import xyz.jwlee.poker.game.rule.SettlementErrorCode;

// 정산 미리보기 결과(성공 여부, 지급액, 오류, 팟별 분배)를 담는다
/** Result of previewing a winner selection; {@code error}/{@code allocations} are null when not applicable. */
public record SettlementPreview(
        boolean ok,
        LinkedHashMap<String, Integer> payouts,
        SettlementErrorCode error,
        List<PotAllocation> allocations) {}
