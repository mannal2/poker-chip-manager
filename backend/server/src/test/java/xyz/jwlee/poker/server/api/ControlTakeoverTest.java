package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
class ControlTakeoverTest {

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

    /** One browser session, which can open several screens (streams). */
    private final class Client {
        final MockHttpSession session;
        final String csrf;
        final String stream;
        String roomId;
        String code;
        String participantId;

        Client() throws Exception {
            MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) first.getRequest().getSession(false);
            csrf = MAPPER.readTree(first.getResponse().getContentAsString()).get("csrfToken").asString();
            stream = openStream();
        }

        String openStream() throws Exception {
            MvcResult r = mvc.perform(post("/api/session/streams").session(session)
                    .header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)).andReturn();
            return MAPPER.readTree(r.getResponse().getContentAsString()).get("streamId").asString();
        }

        ResultActions postJson(String path, String json) throws Exception {
            return mvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)
                    .contentType(MediaType.APPLICATION_JSON).content(json));
        }

        private void adopt(ResultActions result) throws Exception {
            JsonNode body = MAPPER.readTree(result.andReturn().getResponse().getContentAsString());
            roomId = body.get("roomId").asString();
            code = body.get("code").asString();
            participantId = body.get("participantId").asString();
        }

        void create(String name) throws Exception {
            adopt(postJson("/api/rooms", "{\"protocolVersion\":1,\"streamId\":\"" + stream
                    + "\",\"requestId\":\"create\",\"sequence\":1,\"name\":\"" + name + "\"}"));
        }

        void join(String roomCode, String name) throws Exception {
            adopt(postJson("/api/room-joins", "{\"protocolVersion\":1,\"streamId\":\"" + stream
                    + "\",\"requestId\":\"join\",\"sequence\":1,\"code\":\"" + roomCode + "\",\"name\":\"" + name
                    + "\"}"));
        }

        ResultActions control(String streamId, String requestId, long sequence, long expected) throws Exception {
            return postJson("/api/rooms/" + roomId + "/control",
                    "{\"protocolVersion\":1,\"streamId\":\"" + streamId + "\",\"requestId\":\"" + requestId
                            + "\",\"sequence\":" + sequence + ",\"expectedControlGeneration\":" + expected + "}");
        }

        /** SET_DEALER at the room's current version: any screen's generation and sequence. */
        ResultActions dealer(String requestId, long sequence, long generation, String dealerId) throws Exception {
            return dealer(requestId, sequence, generation, dealerId, version());
        }

        ResultActions dealer(String requestId, long sequence, long generation, String dealerId, long expected)
                throws Exception {
            return postJson("/api/rooms/" + roomId + "/commands",
                    "{\"protocolVersion\":1,\"requestId\":\"" + requestId + "\",\"sequence\":" + sequence
                            + ",\"controlGeneration\":" + generation + ",\"expectedStateVersion\":" + expected
                            + ",\"type\":\"SET_DEALER\",\"payload\":{\"participantId\":\"" + dealerId + "\"}}");
        }

        ResultActions getRequest(String requestId) throws Exception {
            return mvc.perform(get("/api/rooms/" + roomId + "/requests/" + requestId).session(session));
        }

        long version() {
            return registry.<Long>withRoom(roomId, room -> room.version());
        }

        boolean hasLedger(long generation) {
            return registry.<Boolean>withRoom(roomId,
                    room -> room.existingLedger(participantId, generation).isPresent());
        }
    }

    private Client host() throws Exception {
        Client c = new Client();
        c.create("Alice");
        return c;
    }

    private Client guestOf(Client host) throws Exception {
        Client c = new Client();
        c.join(host.code, "Bob");
        return c;
    }

    @Test
    void anotherScreenOfTheSameSessionTakesControl() throws Exception {
        Client alice = host();
        String phone = alice.openStream();

        alice.control(phone, "t1", 1, 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("t1"))
                .andExpect(jsonPath("$.sequence").value(1))
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.code").value("OK"))
                .andExpect(jsonPath("$.controlGeneration").value(2))
                .andExpect(jsonPath("$.latestState.you.controlGeneration").value(2));

        mvc.perform(get("/api/rooms/" + alice.roomId + "/state").session(alice.session))
                .andExpect(jsonPath("$.you.controlGeneration").value(2));
    }

    @Test
    void aSessionOutsideTheRoomIsNotFound() throws Exception {
        Client alice = host();
        Client stranger = new Client();
        stranger.roomId = alice.roomId;

        stranger.control(stranger.stream, "t1", 1, 1).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
    }

    @Test
    void aKickedParticipantIsNotFoundAlthoughTheSessionStillNamesTheRoom() throws Exception {
        Client alice = host();
        Client bob = guestOf(alice);
        alice.postJson("/api/rooms/" + alice.roomId + "/commands",
                "{\"protocolVersion\":1,\"requestId\":\"k\",\"sequence\":1,\"controlGeneration\":1,"
                        + "\"expectedStateVersion\":" + alice.version() + ",\"type\":\"KICK\","
                        + "\"payload\":{\"participantId\":\"" + bob.participantId + "\"}}")
                .andExpect(status().isOk());

        bob.control(bob.stream, "t1", 2, 1).andExpect(status().isNotFound());
    }

    @Test
    void aWrongExpectedGenerationIs409AndUsesUpTheStreamSequence() throws Exception {
        Client alice = host();
        String phone = alice.openStream();

        alice.control(phone, "t1", 1, 5).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_LOST"));

        alice.control(phone, "t2", 2, 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.controlGeneration").value(2));
    }

    @Test
    void aRetryOfARejectedTakeoverKeepsItsCodeEvenWhenItWouldNowSucceed() throws Exception {
        Client alice = host();
        String phone = alice.openStream();
        alice.control(phone, "t1", 1, 2).andExpect(status().isConflict());
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());

        alice.control(phone, "t1", 1, 2).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_LOST"));

        assertThat(registry.<Long>withRoom(alice.roomId,
                room -> room.participant(alice.participantId).orElseThrow().controlGeneration())).isEqualTo(2);
    }

    @Test
    void theSameSequenceWithAnotherExpectedGenerationIsARequestConflict() throws Exception {
        Client alice = host();
        String phone = alice.openStream();
        alice.control(phone, "t1", 1, 1).andExpect(status().isOk());

        alice.control(phone, "t1", 1, 2).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_CONFLICT"));
    }

    @Test
    void aSkippedStreamSequenceIsAGapAndAnotherSessionsStreamIsUnknown() throws Exception {
        Client alice = host();
        Client other = new Client();

        alice.control(alice.openStream(), "t1", 2, 1).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SEQUENCE_GAP"));
        alice.control(other.stream, "t1", 1, 1).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("UNKNOWN_STREAM"));
    }

    @Test
    void aBadEnvelopeIsRefusedWithoutTouchingAnything() throws Exception {
        Client alice = host();
        String phone = alice.openStream();
        String path = "/api/rooms/" + alice.roomId + "/control";

        alice.control(phone, "t1", 1, 0).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_INPUT"));
        alice.postJson(path, "{\"protocolVersion\":1,\"streamId\":\"" + phone + "\",\"requestId\":\"t1\","
                + "\"sequence\":1}").andExpect(status().isBadRequest());
        alice.postJson(path, "{\"protocolVersion\":2,\"streamId\":\"" + phone + "\",\"requestId\":\"t1\","
                + "\"sequence\":1,\"expectedControlGeneration\":1}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PROTOCOL_INCOMPATIBLE"));

        alice.control(phone, "t1", 1, 1).andExpect(status().isOk());
    }

    @Test
    void twoScreensTakingControlAtOnceProduceOneWinner() throws Exception {
        Client alice = host();
        List<String> screens = List.of(alice.openStream(), alice.openStream());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 1; round <= 20; round++) {
                long expected = round;
                String requestId = "t" + round;
                CyclicBarrier start = new CyclicBarrier(2);
                List<Future<Integer>> answers = new ArrayList<>();
                for (String stream : screens) {
                    answers.add(pool.submit(() -> {
                        start.await(10, TimeUnit.SECONDS);
                        // Win or lose, each screen used up this round's number.
                        return alice.control(stream, requestId, expected, expected).andReturn().getResponse()
                                .getStatus();
                    }));
                }

                assertThat(List.of(answers.get(0).get(10, TimeUnit.SECONDS), answers.get(1).get(10, TimeUnit.SECONDS)))
                        .containsExactlyInAnyOrder(200, 409);
                assertThat(registry.<Long>withRoom(alice.roomId, room ->
                        room.participant(alice.participantId).orElseThrow().controlGeneration()))
                        .isEqualTo(round + 1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void anOldGenerationsNewCommandsAreAllControlLost() throws Exception {
        Client alice = host();
        alice.dealer("c1", 1, 1, alice.participantId).andExpect(status().isOk());
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());
        long version = alice.version();

        // Next in the old ledger, a gap, and a number already answered with another id.
        for (long sequence : new long[] {2, 9, 1}) {
            alice.dealer("late" + sequence, sequence, 1, alice.participantId).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("CONTROL_LOST"));
        }

        assertThat(alice.version()).isEqualTo(version);
    }

    @Test
    void anOldGenerationsNumberThatConflictsInTheOldLedgerWithTheSameIdIsControlLost() throws Exception {
        Client alice = host();
        alice.dealer("c1", 1, 1, alice.participantId).andExpect(status().isOk());
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());

        alice.dealer("c1", 1, 1, "someone-else").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_LOST"));
    }

    @Test
    void aRetryOnAnOldGenerationReturnsTheStoredResult() throws Exception {
        Client alice = host();
        long before = alice.version();
        alice.dealer("c1", 1, 1, alice.participantId, before).andExpect(status().isOk());
        long applied = alice.version();
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());
        alice.dealer("n1", 1, 2, alice.participantId).andExpect(status().isOk());

        alice.dealer("c1", 1, 1, alice.participantId, before).andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.resultStateVersion").value(applied));
    }

    @Test
    void aNewGenerationStartsAtSequenceOneEvenAfterTheOldScreenWasRefused() throws Exception {
        Client alice = host();
        alice.dealer("c1", 1, 1, alice.participantId).andExpect(status().isOk());
        alice.dealer("c2", 2, 1, alice.participantId).andExpect(status().isOk());
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());
        alice.dealer("late", 3, 1, alice.participantId).andExpect(status().isConflict());

        alice.dealer("n1", 1, 2, alice.participantId).andExpect(status().isOk())
                .andExpect(jsonPath("$.sequence").value(1));
        alice.dealer("n2", 2, 2, alice.participantId).andExpect(status().isOk());
    }

    @Test
    void aFutureGenerationIsControlLostAndLeavesNoLedger() throws Exception {
        Client alice = host();

        alice.dealer("c1", 1, 7, alice.participantId).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONTROL_LOST"));

        assertThat(alice.hasLedger(7)).isFalse();
    }

    @Test
    void aRetriedTakeoverReturnsTheGenerationItFirstIssued() throws Exception {
        Client alice = host();
        String phone = alice.openStream();
        alice.control(phone, "t1", 1, 1).andExpect(status().isOk());
        alice.control(alice.openStream(), "t2", 1, 2).andExpect(status().isOk())
                .andExpect(jsonPath("$.controlGeneration").value(3));

        alice.control(phone, "t1", 1, 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.controlGeneration").value(2))
                .andExpect(jsonPath("$.latestState.you.controlGeneration").value(3));
    }

    @Test
    void aTakeoverLeavesTheVersionSoOthersCommandsStayCurrent() throws Exception {
        Client alice = host();
        Client bob = guestOf(alice);
        long version = alice.version();

        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.latestState.stateVersion").value(version));

        assertThat(alice.version()).isEqualTo(version);
        bob.postJson("/api/rooms/" + bob.roomId + "/commands", "{\"protocolVersion\":1,\"requestId\":\"b1\","
                + "\"sequence\":1,\"controlGeneration\":1,\"expectedStateVersion\":" + version
                + ",\"type\":\"RENAME\",\"payload\":{\"name\":\"Bobby\"}}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("APPLIED"));
    }

    @Test
    void aTakeoverMovesOnlyThatParticipantsGeneration() throws Exception {
        Client alice = host();
        Client bob = guestOf(alice);

        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());

        assertThat(registry.<Long>withRoom(alice.roomId,
                room -> room.participant(bob.participantId).orElseThrow().controlGeneration())).isEqualTo(1);
        assertThat(registry.<String>withRoom(alice.roomId, room -> room.participants().get(0).participantId()))
                .isEqualTo(alice.participantId);
    }

    @Test
    void getRequestStillFindsAnOldGenerationsRequestButNotAnotherParticipants() throws Exception {
        Client alice = host();
        Client bob = guestOf(alice);
        alice.dealer("c1", 1, 1, alice.participantId).andExpect(status().isOk());
        alice.control(alice.openStream(), "t1", 1, 1).andExpect(status().isOk());
        alice.dealer("n1", 1, 2, alice.participantId).andExpect(status().isOk());

        alice.getRequest("c1").andExpect(status().isOk()).andExpect(jsonPath("$.outcome").value("APPLIED"));
        alice.getRequest("n1").andExpect(status().isOk()).andExpect(jsonPath("$.requestId").value("n1"));
        bob.getRequest("c1").andExpect(status().isNotFound());
    }

    @Test
    void getRequestCreatesNoLedger() throws Exception {
        Client alice = host();

        alice.getRequest("never-sent").andExpect(status().isNotFound());

        assertThat(alice.hasLedger(1)).isFalse();
    }

    @Test
    void theRouteIsBehindTheOriginAndCsrfFilters() throws Exception {
        Client alice = host();
        String phone = alice.openStream();
        String path = "/api/rooms/" + alice.roomId + "/control";
        String body = "{\"protocolVersion\":1,\"streamId\":\"" + phone + "\",\"requestId\":\"t1\",\"sequence\":1,"
                + "\"expectedControlGeneration\":1}";

        mvc.perform(post(path).session(alice.session).header("Origin", ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_REJECTED"));
        mvc.perform(post(path).session(alice.session).header("X-CSRF-TOKEN", alice.csrf)
                .header("Origin", "https://evil.example").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ORIGIN_REJECTED"));
        mvc.perform(post(path).header("Origin", ORIGIN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());

        // None of those reached the ledger: the sequence is still free.
        alice.control(phone, "t1", 1, 1).andExpect(status().isOk());
    }
}
