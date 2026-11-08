package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.support.Protocol;

// 요청 봉투 검사가 프로토콜·문자열·정수 필드를 정해진 규칙대로 읽고 거절하는지 확인한다
class EnvelopeTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode json(String text) {
        return MAPPER.readTree(text);
    }

    private static void assertRejected(String code, Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(RoomException.class,
                e -> assertThat(e.code()).isEqualTo(code));
    }

    @Test
    void requireProtocolNeedsAnObjectOfThisVersion() {
        assertThat(Envelope.requireProtocol(json("{\"protocolVersion\":" + Protocol.VERSION + "}")))
                .isEqualTo(Protocol.VERSION);
        assertRejected("INVALID_INPUT", () -> Envelope.requireProtocol(null));
        assertRejected("INVALID_INPUT", () -> Envelope.requireProtocol(json("[]")));
        assertRejected("INVALID_INPUT", () -> Envelope.requireProtocol(json("{}")));
        assertRejected("INVALID_INPUT", () -> Envelope.requireProtocol(json("{\"protocolVersion\":\"1\"}")));
        assertRejected("PROTOCOL_INCOMPATIBLE",
                () -> Envelope.requireProtocol(json("{\"protocolVersion\":" + (Protocol.VERSION + 1) + "}")));
    }

    @Test
    void textReadsANonEmptyBoundedString() {
        assertThat(Envelope.text(json("{\"a\":\"xy\"}"), "a", 2, true)).isEqualTo("xy");
        assertThat(Envelope.text(json("{}"), "a", 2, false)).isNull();
        assertThat(Envelope.text(json("{\"a\":null}"), "a", 2, false)).isNull();
        assertRejected("INVALID_INPUT", () -> Envelope.text(json("{}"), "a", 2, true));
        assertRejected("INVALID_INPUT", () -> Envelope.text(json("{\"a\":null}"), "a", 2, true));
        assertRejected("INVALID_INPUT", () -> Envelope.text(json("{\"a\":\"\"}"), "a", 2, false));
        assertRejected("INVALID_INPUT", () -> Envelope.text(json("{\"a\":\"xyz\"}"), "a", 2, true));
        assertRejected("INVALID_INPUT", () -> Envelope.text(json("{\"a\":1}"), "a", 2, true));
    }

    @Test
    void numberReadsAnIntegerAtLeastTheMinimum() {
        assertThat(Envelope.number(json("{\"a\":1}"), "a", 1)).isEqualTo(1);
        assertThat(Envelope.number(json("{\"a\":0}"), "a", 0)).isZero();
        assertRejected("INVALID_INPUT", () -> Envelope.number(json("{\"a\":0}"), "a", 1));
        assertRejected("INVALID_INPUT", () -> Envelope.number(json("{}"), "a", 0));
        assertRejected("INVALID_INPUT", () -> Envelope.number(json("{\"a\":1.5}"), "a", 0));
        assertRejected("INVALID_INPUT", () -> Envelope.number(json("{\"a\":\"1\"}"), "a", 0));
    }
}
