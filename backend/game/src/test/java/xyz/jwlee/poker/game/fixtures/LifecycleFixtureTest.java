package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

class LifecycleFixtureTest {
    @TestFactory
    List<DynamicTest> lifecycleCases() {
        List<DynamicTest> tests = new ArrayList<>();
        int total = 0;
        for (JsonNode c : FixtureFiles.load("lifecycle")) {
            total++;
            tests.add(dynamicTest(c.get("id").asText() + " " + c.get("description").asText(), () -> FixtureRunner.run(c)));
        }
        assertThat(total).isEqualTo(13);
        assertThat(tests).hasSize(total);
        return tests;
    }
}
