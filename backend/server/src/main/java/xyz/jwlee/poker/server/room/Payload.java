package xyz.jwlee.poker.server.room;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

// 명령 payload의 형식을 검사해 값을 꺼내며, 형식이 틀리면 INVALID_INPUT으로 거절한다
/**
 * Shape checks for command payloads, shared by every command handler. Each check is about type and presence
 * only; whether a value is allowed is the handler's or the rules' decision. A wrong shape is INVALID_INPUT.
 */
final class Payload {

    private Payload() { }

    // payload가 객체인지 확인한다
    static JsonNode object(JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            throw invalid();
        }
        return payload;
    }

    // payload가 없거나 JSON null이거나 빈 객체인지 확인한다
    static void requireEmpty(JsonNode payload) {
        if (payload != null && !payload.isNull() && !(payload.isObject() && payload.isEmpty())) {
            throw invalid();
        }
    }

    // 필수 필드를 꺼내고 없으면 거절한다
    static JsonNode required(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null) {
            throw invalid();
        }
        return v;
    }

    // 문자열 필드를 꺼내고 형식이 틀리면 거절한다
    static String string(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isString()) {
            throw invalid();
        }
        return v.asString();
    }

    // 정수 필드를 꺼내고 형식이 틀리면 거절한다
    static int integer(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isIntegralNumber() || !v.canConvertToInt()) {
            throw invalid();
        }
        return v.asInt();
    }

    // 문자열 배열 필드를 꺼내고 형식이 틀리면 거절한다
    static List<String> strings(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || !v.isArray()) {
            throw invalid();
        }
        List<String> out = new ArrayList<>();
        for (JsonNode e : v) {
            if (!e.isString()) {
                throw invalid();
            }
            out.add(e.asString());
        }
        return out;
    }

    // 팟별 승자 JSON을 맵으로 읽는다
    /** {@code {potId: [playerId, ...]}}. */
    static Map<String, List<String>> winners(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw invalid();
        }
        Map<String, List<String>> out = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : node.properties()) {
            if (!e.getValue().isArray()) {
                throw invalid();
            }
            List<String> ids = new ArrayList<>();
            for (JsonNode id : e.getValue()) {
                if (!id.isString()) {
                    throw invalid();
                }
                ids.add(id.asString());
            }
            out.put(e.getKey(), ids);
        }
        return out;
    }

    // 입력 형식 오류 예외를 만든다
    static RoomException invalid() {
        return new RoomException("INVALID_INPUT");
    }
}
