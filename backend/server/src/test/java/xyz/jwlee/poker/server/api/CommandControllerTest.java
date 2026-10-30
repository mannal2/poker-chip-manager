package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;

@SpringBootTest
@AutoConfigureMockMvc
class CommandControllerTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    /** One browser session. Room-level requests carry no stream; commands count their own sequence. */
    private final class Client {
        final MockHttpSession session;
        final String csrf;
        final String streamId;
        private final AtomicLong screenSequence = new AtomicLong();
        final AtomicLong commandSequence = new AtomicLong();
        String roomId;
        String participantId;
        long version;

        Client() throws Exception {
            MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) first.getRequest().getSession(false);
            csrf = MAPPER.readTree(first.getResponse().getContentAsString()).get("csrfToken").asString();
            MvcResult stream = mvc.perform(post("/api/session/streams").session(session)
                    .header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)).andReturn();
            streamId = MAPPER.readTree(stream.getResponse().getContentAsString()).get("streamId").asString();
        }

        ResultActions postJson(String path, String json) throws Exception {
            return mvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)
                    .contentType(MediaType.APPLICATION_JSON).content(json));
        }

        private String screen(String extra) {
            long n = screenSequence.incrementAndGet();
            return "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"s" + n
                    + "\",\"sequence\":" + n + extra + "}";
        }

        void create(String name) throws Exception {
            MvcResult r = postJson("/api/rooms", screen(",\"name\":\"" + name + "\"")).andReturn();
            adopt(MAPPER.readTree(r.getResponse().getContentAsString()));
        }

        void join(String code, String name) throws Exception {
            MvcResult r = postJson("/api/room-joins", screen(",\"code\":\"" + code + "\",\"name\":\"" + name + "\""))
                    .andReturn();
            adopt(MAPPER.readTree(r.getResponse().getContentAsString()));
        }

        private void adopt(JsonNode body) {
            roomId = body.get("roomId").asString();
            participantId = body.get("participantId").asString();
            version = body.get("state").get("stateVersion").asLong();
        }

        String envelope(String requestId, long sequence, long generation, long expected, String type,
                String payload, String extra) {
            return "{\"protocolVersion\":1,\"requestId\":\"" + requestId + "\",\"sequence\":" + sequence
                    + ",\"controlGeneration\":" + generation + ",\"expectedStateVersion\":" + expected
                    + ",\"type\":\"" + type + "\"" + (payload == null ? "" : ",\"payload\":" + payload)
                    + (extra == null ? "" : extra) + "}";
        }

        /** The next in-sequence command at the version this client last saw. */
        ResultActions command(String type, String payload) throws Exception {
            long n = commandSequence.incrementAndGet();
            ResultActions r = postJson("/api/rooms/" + roomId + "/commands",
                    envelope("c" + n, n, 1, version, type, payload, null));
            return r;
        }

        ResultActions raw(String json) throws Exception {
            return postJson("/api/rooms/" + roomId + "/commands", json);
        }

        ResultActions getRequest(String requestId) throws Exception {
            return mvc.perform(get("/api/rooms/" + roomId + "/requests/" + requestId).session(session));
        }

        ResultActions state() throws Exception {
            return mvc.perform(get("/api/rooms/" + roomId + "/state").session(session));
        }

        /** Applies a command that must succeed and remembers the new version. */
        JsonNode apply(String type, String payload) throws Exception {
            MvcResult r = command(type, payload).andExpect(status().isOk()).andReturn();
            JsonNode body = MAPPER.readTree(r.getResponse().getContentAsString());
            version = body.get("resultStateVersion").asLong();
            return body;
        }
    }

    private Client[] twoInARoom() throws Exception {
        Client host = new Client();
        host.create("Alice");
        String code = registry.<String>withRoom(host.roomId, room -> room.code());
        Client guest = new Client();
        guest.join(code, "Bob");
        host.version = guest.version;
        return new Client[] {host, guest};
    }

    @Test
    void anAppliedCommandAnswersWithTheOutcomeAndTheLatestState() throws Exception {
        Client[] c = twoInARoom();

        c[0].command("SET_DEALER", "{\"participantId\":\"" + c[1].participantId + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("c1"))
                .andExpect(jsonPath("$.sequence").value(1))
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.code").value("OK"))
                .andExpect(jsonPath("$.resultStateVersion").value(c[0].version + 1))
                .andExpect(jsonPath("$.latestState.settings.button").value(1))
                .andExpect(jsonPath("$.latestState.stateVersion").value(c[0].version + 1));
    }

    @Test
    void aGuestCommandIsForbiddenWithTheRejectedOutcome() throws Exception {
        Client[] c = twoInARoom();

        c[1].command("SET_SETTINGS", "{\"initial\":2000,\"sb\":25,\"bb\":50}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.outcome").value("REJECTED"))
                .andExpect(jsonPath("$.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.latestState.roomId").value(c[1].roomId));
    }

    @Test
    void aStaleVersionIs409() throws Exception {
        Client[] c = twoInARoom();
        c[0].version = 0;

        c[0].command("SET_DEALER", "{\"participantId\":\"" + c[1].participantId + "\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STALE_STATE"))
                .andExpect(jsonPath("$.outcome").value("REJECTED"));
    }

    @Test
    void aRuleRejectionIs422() throws Exception {
        Client[] c = twoInARoom();

        c[0].command("SET_SEAT_ORDER", "{\"participantIds\":[\"x\"]}")
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        c[0].command("RENAME", "{\"name\":\"bad_name!\"}")
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_NAME"));
    }

    @Test
    void anUnknownTypeIs422InvalidInput() throws Exception {
        Client[] c = twoInARoom();

        c[0].command("START_TOURNAMENT", "{}").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        c[0].command("WHAT", null).andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
    }

    @Test
    void unparseableJsonIs400AndABadEnvelopeIs400() throws Exception {
        Client[] c = twoInARoom();

        c[0].raw("{not json").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        c[0].raw("{\"protocolVersion\":1,\"requestId\":\"r\",\"sequence\":\"1\",\"controlGeneration\":1,"
                + "\"expectedStateVersion\":0,\"type\":\"LEAVE\"}").andExpect(status().isBadRequest());
        c[0].raw(c[0].envelope("r", 1, 1, 0, "LEAVE", null, null).replace("\"protocolVersion\":1",
                "\"protocolVersion\":2")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROTOCOL_INCOMPATIBLE"));
    }

    @Test
    void aMistypedPayloadFieldIs422() throws Exception {
        Client[] c = twoInARoom();

        c[0].command("SET_SETTINGS", "{\"initial\":\"1000\",\"sb\":10,\"bb\":20}")
                .andExpect(status().is(422)).andExpect(jsonPath("$.code").value("INVALID_INPUT"));
    }

    @Test
    void aWrongControlGenerationIs409ControlLost() throws Exception {
        Client[] c = twoInARoom();

        c[0].raw(c[0].envelope("r1", 1, 5, c[0].version, "LEAVE", "{}", null)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_LOST"));
    }

    @Test
    void aTournamentIdInTheWaitingRoomIs409TournamentChanged() throws Exception {
        Client[] c = twoInARoom();

        c[0].raw(c[0].envelope("r1", 1, 1, c[0].version, "LEAVE", "{}", ",\"tournamentId\":\"t-1\""))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TOURNAMENT_CHANGED"));
    }

    @Test
    void aRetryReturnsTheSameOutcomeWithoutChangingTheRoom() throws Exception {
        Client[] c = twoInARoom();
        String body = c[0].envelope("same", 1, 1, c[0].version, "SET_DEALER",
                "{\"participantId\":\"" + c[1].participantId + "\"}", null);
        MvcResult first = c[0].raw(body).andExpect(status().isOk()).andReturn();

        MvcResult second = c[0].raw(body).andExpect(status().isOk()).andReturn();

        JsonNode a = MAPPER.readTree(first.getResponse().getContentAsString());
        JsonNode b = MAPPER.readTree(second.getResponse().getContentAsString());
        assertThat(b.get("resultStateVersion")).isEqualTo(a.get("resultStateVersion"));
        assertThat(registry.<Long>withRoom(c[0].roomId, room -> room.version()))
                .isEqualTo(a.get("resultStateVersion").asLong());
    }

    @Test
    void theSameSequenceWithAnotherBodyIs409RequestConflict() throws Exception {
        Client[] c = twoInARoom();
        c[0].raw(c[0].envelope("r1", 1, 1, c[0].version, "SET_DEALER",
                "{\"participantId\":\"" + c[1].participantId + "\"}", null)).andExpect(status().isOk());

        c[0].raw(c[0].envelope("r1", 1, 1, c[0].version, "SET_DEALER",
                "{\"participantId\":\"" + c[0].participantId + "\"}", null))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("REQUEST_CONFLICT"));
    }

    @Test
    void getRequestReturnsTheStoredResultAndNotFoundOtherwise() throws Exception {
        Client[] c = twoInARoom();
        c[0].apply("SET_DEALER", "{\"participantId\":\"" + c[1].participantId + "\"}");

        c[0].getRequest("c1").andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("c1"))
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.latestState.settings.button").value(1));
        c[0].getRequest("never-sent").andExpect(status().isNotFound());
        c[1].getRequest("c1").andExpect(status().isNotFound());
    }

    @Test
    void getRequestReturnsARecordedRejectionWithItsStatus() throws Exception {
        Client[] c = twoInARoom();
        c[1].command("KICK", "{\"participantId\":\"" + c[0].participantId + "\"}")
                .andExpect(status().isForbidden());

        c[1].getRequest("c1").andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void aSessionThatIsNotInTheRoomIsNotFound() throws Exception {
        Client[] c = twoInARoom();
        Client stranger = new Client();
        stranger.roomId = c[0].roomId;

        stranger.command("LEAVE", "{}").andExpect(status().isNotFound());
        stranger.getRequest("c1").andExpect(status().isNotFound());
    }

    @Test
    void aKickedParticipantGetsNotFoundAndMayRejoinAsANewOne() throws Exception {
        Client[] c = twoInARoom();
        String code = registry.<String>withRoom(c[0].roomId, room -> room.code());
        c[0].apply("KICK", "{\"participantId\":\"" + c[1].participantId + "\"}");

        c[1].command("LEAVE", "{}").andExpect(status().isNotFound());
        c[1].state().andExpect(status().isNotFound());
        String oldParticipant = c[1].participantId;
        c[1].join(code, "Bob");
        assertThat(c[1].participantId).isNotEqualTo(oldParticipant);
    }

    @Test
    void theLastPersonLeavingDeletesTheRoom() throws Exception {
        Client host = new Client();
        host.create("Alice");

        MvcResult left = host.command("LEAVE", "{}").andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.latestState").value((Object) null)).andReturn();

        assertThat(left.getResponse().getStatus()).isEqualTo(200);
        assertThat(registry.size()).isZero();
        host.state().andExpect(status().isNotFound());
        host.command("LEAVE", "{}").andExpect(status().isNotFound());
        host.getRequest("c1").andExpect(status().isNotFound());
    }

    @Test
    void theHostLeavingPassesTheRoomOnAndTheRoomStays() throws Exception {
        Client[] c = twoInARoom();

        c[0].apply("LEAVE", "{}");

        assertThat(registry.size()).isEqualTo(1);
        c[1].state().andExpect(status().isOk()).andExpect(jsonPath("$.hostId").value(c[1].participantId))
                .andExpect(jsonPath("$.participants.length()").value(1));
    }

    @Test
    void commandsWithoutASessionAreUnauthorized() throws Exception {
        mvc.perform(post("/api/rooms/x/commands").header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{}")).andExpect(status().is4xxClientError());
    }
}
