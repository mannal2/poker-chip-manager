package xyz.jwlee.poker.game.rule;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class ErrorCodeTest {
    /** Round.settle maps a settlement error with RuleErrorCode.valueOf(name). */
    @Test
    void everySettlementErrorIsARuleError() {
        assertThat(Arrays.stream(RuleErrorCode.values()).map(Enum::name))
                .containsAll(Arrays.stream(SettlementErrorCode.values()).map(Enum::name).toList());
    }
}
