package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

class LifecycleFixtureTest {
    /** Command types without a handler yet; enabled in Task 8. */
    private static final Set<String> DEFERRED_COMMANDS = Set.of("SCHEDULE_BLINDS", "ABORT", "UNDO");

    /** Cases using a deferred command; enabled in Task 8. */
    private static final Set<String> DEFERRED_TO_TASK_8 = Set.of("LIF04", "LIF05", "LIF06", "LIF08");

    @TestFactory
    List<DynamicTest> lifecycleCases() {
        List<DynamicTest> tests = new ArrayList<>();
        int total = 0;
        for (JsonNode c : FixtureFiles.load("lifecycle")) {
            total++;
            String id = c.get("id").asText();
            assertThat(usesDeferredCommand(c))
                    .as("%s deferral matches its commands", id)
                    .isEqualTo(DEFERRED_TO_TASK_8.contains(id));
            if (DEFERRED_TO_TASK_8.contains(id)) {
                continue;
            }
            tests.add(dynamicTest(id + " " + c.get("description").asText(), () -> FixtureRunner.run(c)));
        }
        assertThat(total).isEqualTo(13);
        assertThat(tests).hasSize(total - DEFERRED_TO_TASK_8.size());
        return tests;
    }

    private static boolean usesDeferredCommand(JsonNode c) {
        for (JsonNode command : c.get("commands")) {
            if (DEFERRED_COMMANDS.contains(command.get("type").asText())) {
                return true;
            }
        }
        return false;
    }
}
