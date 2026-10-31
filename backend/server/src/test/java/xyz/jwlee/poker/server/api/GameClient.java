package xyz.jwlee.poker.server.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;

/**
 * One browser session playing through the HTTP API. Before every command it reads the room state, so it sends
 * the current version, tournament id and hand id, like a screen that is up to date.
 */
final class GameClient {

    static final String ORIGIN = "http://localhost:5173";
    static final ObjectMapper MAPPER = new ObjectMapper();

    private final MockMvc mvc;
    private final MockHttpSession session;
    private final String csrf;
    private final String streamId;
    private final AtomicLong screenSequence = new AtomicLong();
    private final AtomicLong commandSequence = new AtomicLong();

    String roomId;
    String code;
    String participantId;
    JsonNode state;

    GameClient(MockMvc mvc) throws Exception {
        this.mvc = mvc;
        MvcResult first = mvc.perform(get("/api/session")).andReturn();
        session = (MockHttpSession) first.getRequest().getSession(false);
        csrf = MAPPER.readTree(first.getResponse().getContentAsString()).get("csrfToken").asString();
        MvcResult stream = mvc.perform(post("/api/session/streams").session(session)
                .header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)).andReturn();
        streamId = MAPPER.readTree(stream.getResponse().getContentAsString()).get("streamId").asString();
    }

    /** A room of {@code names.length} people, the first being the host. */
    static GameClient[] room(MockMvc mvc, RoomRegistry registry, String... names) throws Exception {
        GameClient[] clients = new GameClient[names.length];
        for (int i = 0; i < names.length; i++) {
            clients[i] = new GameClient(mvc);
            if (i == 0) {
                clients[i].adopt(clients[i].postJson("/api/rooms", clients[i].screen(",\"name\":\"" + names[i] + "\"")));
            } else {
                clients[i].adopt(clients[i].postJson("/api/room-joins", clients[i].screen(
                        ",\"code\":\"" + clients[0].code + "\",\"name\":\"" + names[i] + "\"")));
            }
            clients[i].connect(registry);
        }
        return clients;
    }

    // 참가 직후 테스트 연결을 붙여 시작 조건을 채운다
    private void connect(RoomRegistry registry) {
        registry.withRoom(roomId, room -> {
            room.presence().attach(participantId, "test-" + participantId, Instant.now());
            return room.bumpVersion();
        });
    }

    private ResultActions postJson(String path, String json) throws Exception {
        return mvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private String screen(String extra) {
        long n = screenSequence.incrementAndGet();
        return "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"s" + n
                + "\",\"sequence\":" + n + extra + "}";
    }

    private void adopt(ResultActions result) throws Exception {
        JsonNode body = MAPPER.readTree(result.andReturn().getResponse().getContentAsString());
        roomId = body.get("roomId").asString();
        code = body.get("code").asString();
        participantId = body.get("participantId").asString();
        state = body.get("state");
    }

    /** Reads the state this participant sees now. */
    JsonNode refresh() throws Exception {
        state = MAPPER.readTree(mvc.perform(get("/api/rooms/" + roomId + "/state").session(session)).andReturn()
                .getResponse().getContentAsString());
        return state;
    }

    String playerId() {
        for (JsonNode p : state.get("participants")) {
            if (p.get("participantId").asString().equals(participantId)) {
                return p.get("playerId").isNull() ? null : p.get("playerId").asString();
            }
        }
        return null;
    }

    String tournamentId() {
        return state.get("tournamentId").isNull() ? null : state.get("tournamentId").asString();
    }

    String handId() {
        JsonNode game = state.get("game");
        return game.isNull() || game.get("hand").isNull() ? null : game.get("hand").get("id").asString();
    }

    /** The next in-sequence command at the latest state; the answer's state is kept as the new view. */
    ResultActions send(String type, String payload) throws Exception {
        refresh();
        return sendAt(type, payload, state.get("stateVersion").asLong(), tournamentId(), handId());
    }

    ResultActions sendAt(String type, String payload, long version, String tournamentId, String handId)
            throws Exception {
        long n = commandSequence.incrementAndGet();
        StringBuilder json = new StringBuilder("{\"protocolVersion\":1,\"requestId\":\"c").append(n)
                .append("\",\"sequence\":").append(n).append(",\"controlGeneration\":1,\"expectedStateVersion\":")
                .append(version).append(",\"type\":\"").append(type).append('"');
        if (payload != null) {
            json.append(",\"payload\":").append(payload);
        }
        if (tournamentId != null) {
            json.append(",\"tournamentId\":\"").append(tournamentId).append('"');
        }
        if (handId != null) {
            json.append(",\"handId\":\"").append(handId).append('"');
        }
        json.append('}');
        return postJson("/api/rooms/" + roomId + "/commands", json.toString());
    }

    ResultActions history(String query) throws Exception {
        return mvc.perform(get("/api/rooms/" + roomId + "/history" + query).session(session));
    }
}
