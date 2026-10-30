package xyz.jwlee.poker.game.fixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import xyz.jwlee.poker.game.Positions;
import xyz.jwlee.poker.game.model.BlindSeats;
import xyz.jwlee.poker.game.model.SeatPositions;

class PositionsFixtureTest {
    @TestFactory
    List<DynamicTest> positionCases() {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : FixtureFiles.load("positions")) {
            tests.add(dynamicTest(c.get("id").asText() + " " + c.get("description").asText(), () -> {
                JsonNode init = c.get("initialState");
                // INITIAL_BLIND_SEATS cases start from an empty state and never use it.
                SeatPositions current = init.has("buttonSeat")
                        ? new SeatPositions(
                                init.get("buttonSeat").asInt(),
                                init.get("sbSeat").asInt(),
                                init.get("bbSeat").asInt())
                        : null;
                for (JsonNode step : c.get("commands")) {
                    boolean[] alive = alive(step.get("alive"));
                    JsonNode expected = step.get("expected");
                    if (step.has("type")) {
                        assertThat(step.get("type").asText()).isEqualTo("INITIAL_BLIND_SEATS");
                        BlindSeats seats = Positions.initialBlindSeats(step.get("button").asInt(), alive);
                        assertThat(seats)
                                .isEqualTo(new BlindSeats(
                                        expected.get("sbSeat").asInt(), expected.get("bbSeat").asInt()));
                    } else {
                        SeatPositions next = Positions.nextPositions(alive, current);
                        assertThat(next)
                                .isEqualTo(new SeatPositions(
                                        expected.get("buttonSeat").asInt(),
                                        expected.get("sbSeat").asInt(),
                                        expected.get("bbSeat").asInt()));
                        current = next;
                    }
                }
            }));
        }
        assertThat(tests).hasSize(15);
        return tests;
    }

    private static boolean[] alive(JsonNode arr) {
        boolean[] out = new boolean[arr.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = arr.get(i).asBoolean();
        }
        return out;
    }
}
