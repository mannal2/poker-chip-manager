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
                JsonNode expected = c.get("expectedStateSubset");
                SettingsValidation result = SettingsValidator.validate(settings);
                assertThat(result instanceof SettingsValidation.Valid).isEqualTo(expected.get("ok").asBoolean());
                if (result instanceof SettingsValidation.Valid valid) {
                    List<String> expectedNames = new ArrayList<>();
                    expected.get("names").forEach(n -> expectedNames.add(n.asText()));
                    assertThat(valid.settings().names()).isEqualTo(expectedNames);
                } else {
                    assertThat(((SettingsValidation.Invalid) result).code().name())
                            .isEqualTo(expected.get("code").asText());
                }
            }));
        }
        assertThat(tests).hasSize(9);
        return tests;
    }
}
