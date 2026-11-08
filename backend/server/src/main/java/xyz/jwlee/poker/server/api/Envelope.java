package xyz.jwlee.poker.server.api;

import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.server.room.ErrorCode;
import xyz.jwlee.poker.server.room.RoomException;
import xyz.jwlee.poker.server.support.Protocol;

// 요청 본문의 공통 필드(프로토콜 버전, 문자열 id, 순번 같은 정수)를 검사해 읽는다
/**
 * Field checks for the request envelope shared by every REST endpoint that changes state. A wrong shape is
 * INVALID_INPUT; a body of another protocol version is PROTOCOL_INCOMPATIBLE.
 */
final class Envelope {

    static final int MAX_ID_LENGTH = 128;

    private Envelope() { }

    // 본문이 객체이고 프로토콜 버전이 맞는지 확인한다
    static int requireProtocol(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw invalid();
        }
        JsonNode version = node.get("protocolVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToInt()) {
            throw invalid();
        }
        if (version.asInt() != Protocol.VERSION) {
            throw new RoomException(ErrorCode.PROTOCOL_INCOMPATIBLE);
        }
        return version.asInt();
    }

    // 문자열 필드의 존재와 길이를 검증해 읽는다
    /** Not required and absent (or JSON null) reads as {@code null}; present, it must be a non-empty string. */
    static String text(JsonNode node, String field, int max, boolean required) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            if (required) {
                throw invalid();
            }
            return null;
        }
        if (!v.isString() || v.asString().isEmpty() || v.asString().length() > max) {
            throw invalid();
        }
        return v.asString();
    }

    // 정수 필드의 형식과 최솟값을 검증해 읽는다
    static long number(JsonNode node, String field, long min) {
        JsonNode v = node.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToLong() || v.asLong() < min) {
            throw invalid();
        }
        return v.asLong();
    }

    // 입력 형식 오류 예외를 만든다
    static RoomException invalid() {
        return new RoomException(ErrorCode.INVALID_INPUT);
    }
}
