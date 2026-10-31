package xyz.jwlee.poker.server.room;

import tools.jackson.databind.node.ObjectNode;
import xyz.jwlee.poker.game.event.GameEvent;
import xyz.jwlee.poker.gamejson.EventJson;

// 기록 조회와 SNAPSHOT이 함께 쓰는 번호 붙은 이벤트 JSON을 만든다
/** Sequence n is the n-th event of the tournament, counted from 1. */
public final class EventView {

    private EventView() {}

    // 이벤트 JSON에 번호를 붙인다
    public static ObjectNode write(GameEvent event, long sequence) {
        ObjectNode json = EventJson.write(event);
        json.put("sequence", sequence);
        return json;
    }
}
