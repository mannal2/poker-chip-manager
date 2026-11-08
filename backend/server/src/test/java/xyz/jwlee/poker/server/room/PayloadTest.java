package xyz.jwlee.poker.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

// 명령 payload 형식 검사가 정상 값은 읽고 형식이 틀리면 INVALID_INPUT으로 거절하는지 확인한다
class PayloadTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String text) {
        return MAPPER.readTree(text);
    }

    private static void assertInvalid(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(RoomException.class,
                e -> assertThat(e.code()).isEqualTo("INVALID_INPUT"));
    }

    @Test
    void objectAcceptsOnlyAnObject() {
        assertThat(Payload.object(json("{\"a\":1}")).get("a").asInt()).isEqualTo(1);
        assertInvalid(() -> Payload.object(null));
        assertInvalid(() -> Payload.object(json("[]")));
        assertInvalid(() -> Payload.object(json("\"x\"")));
    }

    @Test
    void requireEmptyAcceptsNothingNullOrAnEmptyObject() {
        Payload.requireEmpty(null);
        Payload.requireEmpty(json("null"));
        Payload.requireEmpty(json("{}"));
        assertInvalid(() -> Payload.requireEmpty(json("{\"a\":1}")));
        assertInvalid(() -> Payload.requireEmpty(json("[]")));
    }

    @Test
    void requiredNeedsThePresentField() {
        assertThat(Payload.required(json("{\"a\":null}"), "a").isNull()).isTrue();
        assertInvalid(() -> Payload.required(json("{}"), "a"));
    }

    @Test
    void stringNeedsAString() {
        assertThat(Payload.string(json("{\"a\":\"x\"}"), "a")).isEqualTo("x");
        assertThat(Payload.string(json("{\"a\":\"\"}"), "a")).isEmpty();
        assertInvalid(() -> Payload.string(json("{}"), "a"));
        assertInvalid(() -> Payload.string(json("{\"a\":1}"), "a"));
        assertInvalid(() -> Payload.string(json("{\"a\":null}"), "a"));
    }

    @Test
    void integerNeedsAnIntInRange() {
        assertThat(Payload.integer(json("{\"a\":-5}"), "a")).isEqualTo(-5);
        assertInvalid(() -> Payload.integer(json("{}"), "a"));
        assertInvalid(() -> Payload.integer(json("{\"a\":1.5}"), "a"));
        assertInvalid(() -> Payload.integer(json("{\"a\":\"1\"}"), "a"));
        assertInvalid(() -> Payload.integer(json("{\"a\":3000000000}"), "a"));
    }

    @Test
    void stringsNeedsAnArrayOfStrings() {
        assertThat(Payload.strings(json("{\"a\":[\"x\",\"y\"]}"), "a")).containsExactly("x", "y");
        assertThat(Payload.strings(json("{\"a\":[]}"), "a")).isEmpty();
        assertInvalid(() -> Payload.strings(json("{}"), "a"));
        assertInvalid(() -> Payload.strings(json("{\"a\":\"x\"}"), "a"));
        assertInvalid(() -> Payload.strings(json("{\"a\":[\"x\",1]}"), "a"));
    }

    @Test
    void winnersNeedsAnObjectOfStringArraysInOrder() {
        assertThat(Payload.winners(json("{\"pot1\":[\"p1\"],\"pot0\":[\"p0\",\"p2\"]}")))
                .containsExactly(Map.entry("pot1", List.of("p1")), Map.entry("pot0", List.of("p0", "p2")));
        assertInvalid(() -> Payload.winners(null));
        assertInvalid(() -> Payload.winners(json("[]")));
        assertInvalid(() -> Payload.winners(json("{\"pot0\":\"p0\"}")));
        assertInvalid(() -> Payload.winners(json("{\"pot0\":[1]}")));
    }
}
