package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.game.rule.RuleErrorCode;
import xyz.jwlee.poker.game.rule.SettlementErrorCode;
import xyz.jwlee.poker.game.settings.SettingsErrorCode;

// 공용 오류 코드 목록(shared/error-codes.json)이 서버 enum과 규칙 모듈 enum과 같은지 확인한다
class ErrorCodeContractTest {

    private static JsonNode contract() throws Exception {
        Path file = Path.of("..", "..", "shared", "error-codes.json").toAbsolutePath().normalize();
        return new ObjectMapper().readTree(Files.readString(file));
    }

    private static List<String> names(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asString()));
        return out;
    }

    @Test
    void serverCodesMatchTheEnum() throws Exception {
        assertThat(names(contract().get("server")))
                .containsExactlyInAnyOrderElementsOf(Arrays.stream(ErrorCode.values()).map(Enum::name).toList());
    }

    @Test
    void ruleCodesMatchTheRulesModule() throws Exception {
        List<String> rules = Stream.of(RuleErrorCode.values(), SettlementErrorCode.values(), SettingsErrorCode.values())
                .flatMap(Arrays::stream).map(Enum::name).distinct().toList();
        assertThat(names(contract().get("rules"))).containsExactlyInAnyOrderElementsOf(rules);
    }

    @Test
    void codesNotShownOnScreenAreKnownCodes() throws Exception {
        JsonNode c = contract();
        List<String> known = new ArrayList<>(names(c.get("server")));
        known.addAll(names(c.get("rules")));
        assertThat(known).containsAll(names(c.get("notShown")));
    }
}
