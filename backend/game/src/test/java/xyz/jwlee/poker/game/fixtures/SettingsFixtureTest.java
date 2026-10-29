package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.model.GameSettings;
import xyz.jwlee.poker.game.settings.SettingsValidation;
import xyz.jwlee.poker.game.settings.SettingsValidator;

class SettingsFixtureTest {
    @TestFactory
    List<DynamicTest> settingsCases() {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : FixtureFiles.load("settings")) {
            tests.add(dynamicTest(c.get("id").asText() + " " + c.get("description").asText(), () -> {
                JsonNode in = c.get("initialState");
                List<String> names = new ArrayList<>();
                in.get("names").forEach(n -> names.add(n.asText()));
                GameSettings settings = new GameSettings(
                        names,
                        in.get("initial").asInt(),
                        in.get("sb").asInt(),
                        in.get("bb").asInt(),
                        in.get("button").asInt());
                boolean expectedOk = c.get("expectedStateSubset").get("ok").asBoolean();
                assertThat(SettingsValidator.validate(settings) instanceof SettingsValidation.Valid)
                        .isEqualTo(expectedOk);
            }));
        }
        assertThat(tests).hasSize(7);
        return tests;
    }
}
