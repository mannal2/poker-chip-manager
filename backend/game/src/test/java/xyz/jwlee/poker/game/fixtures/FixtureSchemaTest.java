package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class FixtureSchemaTest {
    @ParameterizedTest
    @ValueSource(strings = {"settings", "positions", "betting", "pots", "settlement", "lifecycle", "undo", "forfeit"})
    void everyCaseHasIdSuiteAndCommands(String suite) {
        List<JsonNode> cases = FixtureFiles.load(suite);

        assertThat(cases).isNotEmpty();
        Set<String> ids = new HashSet<>();
        for (JsonNode testCase : cases) {
            assertThat(testCase.path("id").isTextual()).as("id in %s", suite).isTrue();
            assertThat(testCase.path("suite").asText()).as("suite of %s", testCase.path("id")).isEqualTo(suite);
            assertThat(testCase.path("commands").isArray()).as("commands of %s", testCase.path("id")).isTrue();
            assertThat(ids.add(testCase.get("id").asText())).as("unique id %s", testCase.get("id")).isTrue();
        }
    }

    @Test
    void unknownSuiteIsRejected() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> FixtureFiles.load("nope"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
