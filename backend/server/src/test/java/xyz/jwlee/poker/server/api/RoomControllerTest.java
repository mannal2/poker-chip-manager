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
import xyz.jwlee.poker.server.auth.SessionIdentity;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.RoomPhase;

@SpringBootTest
@AutoConfigureMockMvc
class RoomControllerTest {

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

    /** One browser session with a registered screen stream and its own request counters. */
    private final class Client {
        final MockHttpSession session;
        final String csrf;
        final String streamId;
        private final AtomicLong sequence = new AtomicLong();
        private final AtomicLong requests = new AtomicLong();

        Client() throws Exception {
            MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) first.getRequest().getSession(false);
            csrf = MAPPER.readTree(first.getResponse().getContentAsString()).get("csrfToken").asString();
            MvcResult stream = mvc.perform(post("/api/session/streams").session(session)
                    .header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)).andReturn();
            streamId = MAPPER.readTree(stream.getResponse().getContentAsString()).get("streamId").asString();
        }

        String body(String extra) {
            return "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"r"
                    + requests.incrementAndGet() + "\",\"sequence\":" + sequence.incrementAndGet() + extra + "}";
        }

        ResultActions postJson(String path, String json) throws Exception {
            return mvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)
                    .contentType(MediaType.APPLICATION_JSON).content(json));
        }

        JsonNode create(String name) throws Exception {
            MvcResult r = postJson("/api/rooms", body(",\"name\":\"" + name + "\"")).andExpect(status().isCreated())
                    .andReturn();
            return MAPPER.readTree(r.getResponse().getContentAsString());
        }

        ResultActions join(String code, String name) throws Exception {
            return postJson("/api/room-joins", body(",\"code\":\"" + code + "\",\"name\":\"" + name + "\""));
        }

        ResultActions state(String roomId) throws Exception {
            return mvc.perform(get("/api/rooms/" + roomId + "/state").session(session));
        }
    }

    @Test
    void createReturnsTheRoomTheParticipantAndTheHostSnapshot() throws Exception {
        Client host = new Client();

        JsonNode created = host.create("Alice");

        assertThat(created.get("roomId").asString()).isNotBlank();
        assertThat(created.get("code").asString()).matches("[A-HJKMNP-Z2-9]{6}");
        assertThat(created.get("controlGeneration").asInt()).isEqualTo(1);
        JsonNode state = created.get("state");
        assertThat(state.get("roomPhase").asString()).isEqualTo("WAITING");
        assertThat(state.get("hostId").asString()).isEqualTo(created.get("participantId").asString());
        assertThat(state.get("game").isNull()).isTrue();
        assertThat(state.get("legal").isNull()).isTrue();
        assertThat(state.get("settlementDraft").isNull()).isTrue();
        assertThat(state.get("settings").get("initial").asInt()).isPositive();
        assertThat(state.get("you").get("capabilities").get("canEditSetup").asBoolean()).isTrue();
        assertThat(state.get("you").get("capabilities").get("canAct").asBoolean()).isFalse();
        JsonNode first = state.get("participants").get(0);
        assertThat(first.get("name").asString()).isEqualTo("Alice");
        assertThat(first.get("seat").asInt()).isZero();
        assertThat(first.get("isHost").asBoolean()).isTrue();
    }

    @Test
    void theCreatorReadsStateWithTheSameSession() throws Exception {
        Client host = new Client();
        JsonNode created = host.create("Alice");

        host.state(created.get("roomId").asString()).andExpect(status().isOk())
                .andExpect(jsonPath("$.you.participantId").value(created.get("participantId").asString()))
                .andExpect(jsonPath("$.participants[0].isHost").value(true))
                .andExpect(jsonPath("$.stateVersion").isNumber());
    }

    @Test
    void anotherSessionCannotReadTheState() throws Exception {
        JsonNode created = new Client().create("Alice");

        new Client().state(created.get("roomId").asString()).andExpect(status().isNotFound());
    }

    @Test
    void stateWithoutASessionIsUnauthorized() throws Exception {
        mvc.perform(get("/api/rooms/x/state")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("NO_SESSION"));
    }

    @Test
    void aSessionBoundToAParticipantNoLongerOnTheRosterGetsNotFound() throws Exception {
        Client host = new Client();
        JsonNode created = host.create("Alice");
        Client ghost = new Client();
        SessionIdentity.from(ghost.session).bind(created.get("roomId").asString(), "gone");

        ghost.state(created.get("roomId").asString()).andExpect(status().isNotFound());
    }

    @Test
    void joiningAddsParticipantsInSeatOrder() throws Exception {
        Client host = new Client();
        JsonNode created = host.create("Alice");
        Client guest = new Client();

        guest.join(created.get("code").asString().toLowerCase(), "Bob").andExpect(status().isOk())
                .andExpect(jsonPath("$.roomId").value(created.get("roomId").asString()))
                .andExpect(jsonPath("$.participantId").isNotEmpty())
                .andExpect(jsonPath("$.state.participants.length()").value(2))
                .andExpect(jsonPath("$.state.participants[1].name").value("Bob"))
                .andExpect(jsonPath("$.state.participants[1].seat").value(1))
                .andExpect(jsonPath("$.state.participants[1].isHost").value(false))
                .andExpect(jsonPath("$.state.you.capabilities.canEditSetup").value(false));
        host.state(created.get("roomId").asString())
                .andExpect(jsonPath("$.participants.length()").value(2))
                .andExpect(jsonPath("$.you.capabilities.canEditSetup").value(true));
    }

    @Test
    void aNameDifferingOnlyInCaseIsADuplicate() throws Exception {
        JsonNode created = new Client().create("Alice");

        new Client().join(created.get("code").asString(), "aLiCe").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
    }

    @Test
    void invalidNamesAreUnprocessable() throws Exception {
        Client c = new Client();
        c.postJson("/api/rooms", c.body(",\"name\":\"bad_name\"")).andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_NAME"));
        c.postJson("/api/rooms", c.body(",\"name\":\"   \"")).andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("INVALID_NAME"));
        assertThat(registry.size()).isZero();
    }

    @Test
    void joiningAnUnknownCodeIsNotFound() throws Exception {
        new Client().join("ZZZZZZ", "Bob").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
    }

    @Test
    void joiningARoomThatIsNotWaitingIsRefused() throws Exception {
        JsonNode created = new Client().create("Alice");
        registry.withRoom(created.get("roomId").asString(), room -> {
            room.setPhase(RoomPhase.PLAYING);
            return null;
        });

        new Client().join(created.get("code").asString(), "Bob").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("NOT_WAITING"));
    }

    @Test
    void theEleventhParticipantIsRefusedWithRoomFull() throws Exception {
        JsonNode created = new Client().create("Alice");
        for (int i = 0; i < 9; i++) {
            registry.join(created.get("code").asString(), "p" + i);
        }

        new Client().join(created.get("code").asString(), "Late").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("ROOM_FULL"));
    }

    @Test
    void theEleventhRoomIsRefusedWith503() throws Exception {
        for (int i = 0; i < 10; i++) {
            new Client().create("h" + i);
        }
        Client c = new Client();

        c.postJson("/api/rooms", c.body(",\"name\":\"late\"")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("ROOM_LIMIT"));
    }

    @Test
    void resendingTheSameCreateRequestReturnsTheSameRoomAndCreatesNoSecondOne() throws Exception {
        Client c = new Client();
        String json = c.body(",\"name\":\"Alice\"");

        MvcResult first = c.postJson("/api/rooms", json).andExpect(status().isCreated()).andReturn();
        MvcResult again = c.postJson("/api/rooms", json).andExpect(status().isCreated()).andReturn();

        JsonNode a = MAPPER.readTree(first.getResponse().getContentAsString());
        JsonNode b = MAPPER.readTree(again.getResponse().getContentAsString());
        assertThat(b.get("roomId")).isEqualTo(a.get("roomId"));
        assertThat(b.get("participantId")).isEqualTo(a.get("participantId"));
        assertThat(registry.size()).isEqualTo(1);
    }

    @Test
    void resendingTheSameJoinRequestAddsNoSecondParticipant() throws Exception {
        JsonNode created = new Client().create("Alice");
        Client guest = new Client();
        String json = guest.body(",\"code\":\"" + created.get("code").asString() + "\",\"name\":\"Bob\"");

        guest.postJson("/api/room-joins", json).andExpect(status().isOk());
        guest.postJson("/api/room-joins", json).andExpect(status().isOk())
                .andExpect(jsonPath("$.state.participants.length()").value(2));
        guest.state(created.get("roomId").asString()).andExpect(jsonPath("$.participants.length()").value(2));
    }

    @Test
    void aRejectedRequestIsReplayedAsTheSameRejection() throws Exception {
        JsonNode created = new Client().create("Alice");
        Client guest = new Client();
        String json = guest.body(",\"code\":\"" + created.get("code").asString() + "\",\"name\":\"alice\"");

        guest.postJson("/api/room-joins", json).andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
        guest.postJson("/api/room-joins", json).andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
    }

    @Test
    void reusingASequenceForADifferentRequestConflicts() throws Exception {
        Client c = new Client();
        c.create("Alice");

        c.postJson("/api/rooms", "{\"protocolVersion\":1,\"streamId\":\"" + c.streamId
                + "\",\"requestId\":\"other\",\"sequence\":1,\"name\":\"Bob\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("REQUEST_CONFLICT"));
    }

    @Test
    void aSkippedSequenceIsAGap() throws Exception {
        Client c = new Client();
        c.postJson("/api/rooms", "{\"protocolVersion\":1,\"streamId\":\"" + c.streamId
                + "\",\"requestId\":\"x\",\"sequence\":5,\"name\":\"Bob\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SEQUENCE_GAP"));
    }

    @Test
    void anUnregisteredStreamIsRefused() throws Exception {
        Client c = new Client();
        c.postJson("/api/rooms", "{\"protocolVersion\":1,\"streamId\":\"nope\",\"requestId\":\"x\","
                + "\"sequence\":1,\"name\":\"Bob\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("UNKNOWN_STREAM"));
    }

    @Test
    void anotherProtocolVersionIsIncompatible() throws Exception {
        Client c = new Client();
        c.postJson("/api/rooms", "{\"protocolVersion\":2,\"streamId\":\"" + c.streamId
                + "\",\"requestId\":\"x\",\"sequence\":1,\"name\":\"Bob\"}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PROTOCOL_INCOMPATIBLE"));
    }

    @Test
    void malformedInputIsABadRequestNeverA500() throws Exception {
        Client c = new Client();
        String s = c.streamId;
        String[] bad = {
            "",
            "not json",
            "[]",
            "null",
            "{\"protocolVersion\":\"1\",\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":1,\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"requestId\":\"x\",\"sequence\":1,\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"streamId\":7,\"requestId\":\"x\",\"sequence\":1,\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":\"1\",\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":1.5,\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":0,\"name\":\"B\"}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":1}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":1,\"name\":null}",
            "{\"protocolVersion\":1,\"streamId\":\"" + s + "\",\"requestId\":\"x\",\"sequence\":1,\"name\":5}",
        };
        for (String json : bad) {
            c.postJson("/api/rooms", json).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        }
        c.postJson("/api/room-joins", c.body(",\"name\":\"B\"")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        assertThat(registry.size()).isZero();
    }

    @Test
    void aWrongMediaTypeIsNotA500() throws Exception {
        Client c = new Client();
        mvc.perform(post("/api/rooms").session(c.session).header("X-CSRF-TOKEN", c.csrf).header("Origin", ORIGIN)
                        .contentType(MediaType.TEXT_PLAIN).content("x"))
                .andExpect(status().is4xxClientError()).andExpect(jsonPath("$.code").isNotEmpty());
    }
}
