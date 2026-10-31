package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.MutableClock;
import xyz.jwlee.poker.server.room.RoomEnv;
import xyz.jwlee.poker.server.room.RoomLifecycle;
import xyz.jwlee.poker.server.support.IdGenerator;

// 복구 신청·조회와 승인 뒤 옛 기기의 모든 HTTP 경로를 검사한다
@SpringBootTest
@AutoConfigureMockMvc
@Import(RecoveryApiTest.Timed.class)
class RecoveryApiTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-10-31T00:00:00Z"));

    // 테스트가 직접 진행시키는 시계를 넣는다
    @TestConfiguration(proxyBeanMethods = false)
    static class Timed {
        @Bean
        @Primary
        Clock recoveryClock() {
            return CLOCK;
        }
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    // 같은 컨텍스트를 쓰는 다른 테스트의 방을 비운다
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 세션 하나와 화면 스트림 하나를 가진 브라우저를 흉내 낸다
    private final class Client {
        final MockHttpSession session;
        final String csrf;
        final String stream;
        String roomId;
        String code;
        String participantId;
        long screen;
        long sequence;
        long generation = 1;

        Client() throws Exception {
            MvcResult first = mvc.perform(get("/api/session")).andExpect(status().isOk()).andReturn();
            session = (MockHttpSession) first.getRequest().getSession(false);
            csrf = MAPPER.readTree(first.getResponse().getContentAsString()).get("csrfToken").asString();
            MvcResult r = mvc.perform(post("/api/session/streams").session(session)
                    .header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)).andReturn();
            stream = MAPPER.readTree(r.getResponse().getContentAsString()).get("streamId").asString();
        }

        // JSON 본문으로 POST를 보낸다
        ResultActions postJson(String path, String json) throws Exception {
            return mvc.perform(post(path).session(session).header("X-CSRF-TOKEN", csrf).header("Origin", ORIGIN)
                    .contentType(MediaType.APPLICATION_JSON).content(json));
        }

        // 세션으로 GET을 보낸다
        ResultActions read(String path) throws Exception {
            return mvc.perform(get(path).session(session));
        }

        // 화면 스트림 요청 본문을 만든다
        String envelope(String fields) {
            long n = ++screen;
            return "{\"protocolVersion\":1,\"streamId\":\"" + stream + "\",\"requestId\":\"s" + n + "\",\"sequence\":"
                    + n + "," + fields + "}";
        }

        // 응답에서 방과 자리 정보를 받아 둔다
        Client adopt(ResultActions result) throws Exception {
            JsonNode answer = body(result);
            roomId = answer.get("roomId").asString();
            code = answer.get("code").asString();
            participantId = answer.get("participantId").asString();
            return this;
        }

        // 방을 만든다
        Client create(String name) throws Exception {
            return adopt(postJson("/api/rooms", envelope("\"name\":\"" + name + "\"")));
        }

        // 코드로 참가한다
        Client join(String roomCode, String name) throws Exception {
            return adopt(postJson("/api/room-joins", envelope("\"code\":\"" + roomCode + "\",\"name\":\"" + name
                    + "\"")));
        }

        // 복구를 신청한다
        ResultActions ask(String roomCode, String name) throws Exception {
            return postJson("/api/recovery-requests", envelope("\"code\":\"" + roomCode + "\",\"name\":\"" + name
                    + "\""));
        }

        // 복구를 신청하고 신청 ID를 돌려준다
        String asked(String roomCode, String name) throws Exception {
            return body(ask(roomCode, name).andExpect(status().isCreated())).get("recoveryRequestId").asString();
        }

        // 신청 결과를 조회한다
        ResultActions recovery(String id) throws Exception {
            return read("/api/recovery-requests/" + id);
        }

        // 이 방의 상태를 조회한다
        ResultActions state() throws Exception {
            return read("/api/rooms/" + roomId + "/state");
        }

        // 지금 보이는 상태를 읽는다
        JsonNode view() throws Exception {
            return body(state().andExpect(status().isOk()));
        }

        // 주어진 시점의 상태 기준으로 명령을 보낸다
        ResultActions commandAt(JsonNode view, String type, String payload) throws Exception {
            long n = ++sequence;
            StringBuilder json = new StringBuilder("{\"protocolVersion\":1,\"requestId\":\"").append(participantId)
                    .append('-').append(generation).append('-').append(n).append("\",\"sequence\":").append(n)
                    .append(",\"controlGeneration\":").append(generation).append(",\"expectedStateVersion\":")
                    .append(view.get("stateVersion").asLong()).append(",\"type\":\"").append(type)
                    .append("\",\"payload\":").append(payload);
            if (!view.get("tournamentId").isNull()) {
                json.append(",\"tournamentId\":\"").append(view.get("tournamentId").asString()).append('"');
            }
            JsonNode game = view.get("game");
            if (!game.isNull() && !game.get("hand").isNull()) {
                json.append(",\"handId\":\"").append(game.get("hand").get("id").asString()).append('"');
            }
            return postJson("/api/rooms/" + roomId + "/commands", json.append('}').toString());
        }

        // 최신 상태 기준으로 명령을 보내고 성공을 확인한다
        ResultActions command(String type, String payload) throws Exception {
            return commandAt(view(), type, payload).andExpect(status().isOk());
        }

        // 신청을 승인한다
        ResultActions approve(String id) throws Exception {
            return command("RECOVERY_APPROVE", "{\"recoveryRequestId\":\"" + id + "\"}");
        }

        // 테스트 연결을 붙여 시작 조건을 채운다
        void connect() {
            registry.update(roomId, room -> {
                room.presence().attach(participantId, "test-" + participantId, CLOCK.instant());
                return room.bumpVersion();
            });
        }
    }

    // 응답 본문을 읽는다
    private static JsonNode body(ResultActions result) throws Exception {
        return MAPPER.readTree(result.andReturn().getResponse().getContentAsString());
    }

    // 방장 Alice를 만든다
    private Client host() throws Exception {
        return new Client().create("Alice");
    }

    // 방에 Bob을 참가시킨다
    private Client bob(Client host) throws Exception {
        return new Client().join(host.code, "Bob");
    }

    // 두 사람이 게임을 시작한다
    private void start(Client alice, Client bob) throws Exception {
        alice.connect();
        bob.connect();
        alice.command("SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}");
        alice.command("START", "{}");
    }

    // 새 기기가 승인된 신청을 조회해 자리를 넘겨받는다
    private Client recovered(Client device, Client seat, String id) throws Exception {
        device.recovery(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("APPROVED"));
        device.roomId = seat.roomId;
        device.code = seat.code;
        device.participantId = seat.participantId;
        device.generation = seat.generation + 1;
        return device;
    }

    // 스냅샷에서 이 기기의 플레이어 ID를 읽는다
    private static String playerOf(Client client) throws Exception {
        for (JsonNode p : client.view().get("participants")) {
            if (p.get("participantId").asString().equals(client.participantId)) {
                return p.get("playerId").asString();
            }
        }
        throw new AssertionError("not on the roster");
    }

    @Test
    void aRequestAnswersIdPendingAndExpiry() throws Exception {
        Client alice = host();
        bob(alice);

        new Client().ask(alice.code, "bob").andExpect(status().isCreated())
                .andExpect(jsonPath("$.recoveryRequestId").isString())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.expiresAt").value(CLOCK.instant().plus(Duration.ofMinutes(5)).toString()))
                .andExpect(result -> assertThat(result.getResponse().getHeader("Cache-Control")).isEqualTo("no-store"));
    }

    @Test
    void aRetriedRequestMakesOnlyOne() throws Exception {
        Client alice = host();
        Client device = new Client();
        bob(alice);
        String request = device.envelope("\"code\":\"" + alice.code + "\",\"name\":\"Bob\"");

        String first = body(device.postJson("/api/recovery-requests", request).andExpect(status().isCreated()))
                .get("recoveryRequestId").asString();
        String again = body(device.postJson("/api/recovery-requests", request).andExpect(status().isCreated()))
                .get("recoveryRequestId").asString();

        assertThat(again).isEqualTo(first);
        assertThat(alice.view().get("recoveryRequests")).hasSize(1);
    }

    @Test
    void theSameSequenceWithAnotherNameIsARequestConflict() throws Exception {
        Client alice = host();
        Client device = new Client();
        bob(alice);
        device.ask(alice.code, "Bob").andExpect(status().isCreated());
        device.screen = 0;

        device.ask(alice.code, "Alice").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REQUEST_CONFLICT"));
    }

    @Test
    void aRefusedRequestIsAnsweredTheSameOnRetry() throws Exception {
        Client alice = host();
        Client device = new Client();
        String request = device.envelope("\"code\":\"" + alice.code + "\",\"name\":\"Bob\"");

        device.postJson("/api/recovery-requests", request).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECOVERY_TARGET_NOT_FOUND"));
        bob(alice);
        device.postJson("/api/recovery-requests", request).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECOVERY_TARGET_NOT_FOUND"));
    }

    @Test
    void anUnknownNameACodeThatDoesNotExistAndASeatedSessionAreRefused() throws Exception {
        Client alice = host();
        Client bob = bob(alice);

        new Client().ask(alice.code, "Nobody").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECOVERY_TARGET_NOT_FOUND"));
        new Client().ask("ZZZZZZ", "Bob").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        bob.ask(alice.code, "Alice").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("ALREADY_PARTICIPANT"));
        bob.ask(alice.code, "Bob").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("ALREADY_PARTICIPANT"));
    }

    @Test
    void theFourthRequestOfASeatIsTheLimit() throws Exception {
        Client alice = host();
        bob(alice);
        for (int i = 0; i < 3; i++) {
            new Client().ask(alice.code, "Bob").andExpect(status().isCreated());
        }

        new Client().ask(alice.code, "Bob").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("RECOVERY_LIMIT"));
    }

    @Test
    void aMalformedRequestIsInvalid() throws Exception {
        Client device = new Client();

        device.postJson("/api/recovery-requests", "{}").andExpect(status().isBadRequest());
        device.postJson("/api/recovery-requests", device.envelope("\"code\":\"ABC234\""))
                .andExpect(status().isBadRequest());
    }

    @Test
    void theRouteNeedsASessionAndCsrf() throws Exception {
        Client device = new Client();
        String request = device.envelope("\"code\":\"ABC234\",\"name\":\"Bob\"");

        mvc.perform(post("/api/recovery-requests").session(device.session).header("Origin", ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content(request)).andExpect(status().isForbidden());
        mvc.perform(post("/api/recovery-requests").header("Origin", ORIGIN)
                .contentType(MediaType.APPLICATION_JSON).content(request)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/recovery-requests/x")).andExpect(status().isUnauthorized());
    }

    @Test
    void anotherSessionCannotReadARequestAndARequestIsNoSeat() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");
        device.roomId = alice.roomId;

        new Client().recovery(id).andExpect(status().isNotFound());
        bob.recovery(id).andExpect(status().isNotFound());
        alice.recovery(id).andExpect(status().isNotFound());
        device.recovery(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.state").doesNotExist()).andExpect(jsonPath("$.participantId").doesNotExist());
        device.state().andExpect(status().isNotFound());
    }

    @Test
    void theFirstReadAfterApprovalLinksTheSessionAndALostAnswerCanBeReadAgain() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");
        device.roomId = alice.roomId;
        device.state().andExpect(status().isNotFound());

        alice.approve(id);
        device.state().andExpect(status().isNotFound());

        JsonNode first = body(device.recovery(id).andExpect(status().isOk())
                .andExpect(jsonPath("$.recoveryRequestId").value(id))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.roomId").value(alice.roomId))
                .andExpect(jsonPath("$.code").value(alice.code))
                .andExpect(jsonPath("$.participantId").value(bob.participantId))
                .andExpect(jsonPath("$.controlGeneration").value(2))
                .andExpect(jsonPath("$.state.you.participantId").value(bob.participantId)));
        JsonNode second = body(device.recovery(id).andExpect(status().isOk()));

        assertThat(second).isEqualTo(first);
        device.state().andExpect(status().isOk());
    }

    @Test
    void aRejectedRequestGivesNoSeat() throws Exception {
        Client alice = host();
        bob(alice);
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");
        device.roomId = alice.roomId;

        alice.command("RECOVERY_REJECT", "{\"recoveryRequestId\":\"" + id + "\"}");

        device.recovery(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.participantId").doesNotExist());
        device.state().andExpect(status().isNotFound());
    }

    @Test
    void aRequestShowsExpiredAtItsTimeAndIsGoneFiveMinutesAfterTheSweep() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        alice.connect();
        bob.connect();
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");

        CLOCK.advance(Duration.ofMinutes(5));
        device.recovery(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("EXPIRED"));

        registry.sweepAll();
        CLOCK.advance(Duration.ofMinutes(5));
        registry.sweepAll();
        device.recovery(id).andExpect(status().isNotFound());
    }

    @Test
    void anApprovedRequestWhoseSeatMovedOnGivesNoSeat() throws Exception {
        Client alice = host();
        bob(alice);
        Client first = new Client();
        String firstId = first.asked(alice.code, "Bob");
        first.roomId = alice.roomId;
        alice.approve(firstId);
        Client second = new Client();
        alice.approve(second.asked(alice.code, "Bob"));

        first.recovery(firstId).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SUPERSEDED"))
                .andExpect(jsonPath("$.participantId").doesNotExist());
        first.state().andExpect(status().isNotFound());
    }

    @Test
    void theOldDeviceLosesEveryPathIntoTheSeat() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        start(alice, bob);
        String tournamentId = bob.view().get("tournamentId").asString();
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");
        JsonNode chips = alice.view().get("game").get("players");

        alice.approve(id);
        recovered(device, bob, id);

        bob.state().andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        bob.read("/api/rooms/" + bob.roomId + "/history?tournamentId=" + tournamentId)
                .andExpect(status().isNotFound());
        bob.read("/api/rooms/" + bob.roomId + "/requests/any").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        JsonNode latest = alice.view();
        bob.commandAt(latest, "FOLD", "{}").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        bob.generation = 2;
        bob.commandAt(latest, "FOLD", "{}").andExpect(status().isNotFound());
        bob.postJson("/api/rooms/" + bob.roomId + "/control", bob.envelope("\"expectedControlGeneration\":2"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));

        assertThat(alice.view().get("game").get("players")).isEqualTo(chips);
        assertThat(alice.view().get("stateVersion").asLong()).isEqualTo(latest.get("stateVersion").asLong());
        device.state().andExpect(status().isOk()).andExpect(jsonPath("$.you.controlGeneration").value(2));
    }

    @Test
    void retriesOfTheOldDevicesEarlierRequestsShowNothing() throws Exception {
        Client alice = host();
        Client device = new Client();
        Client bob = new Client();
        String joinBody = bob.envelope("\"code\":\"" + alice.code + "\",\"name\":\"Bob\"");
        bob.adopt(bob.postJson("/api/room-joins", joinBody).andExpect(status().isOk()));
        String controlBody = bob.envelope("\"expectedControlGeneration\":1");
        bob.postJson("/api/rooms/" + bob.roomId + "/control", controlBody).andExpect(status().isOk());
        String id = device.asked(alice.code, "Bob");

        alice.approve(id);

        bob.postJson("/api/room-joins", joinBody).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        bob.postJson("/api/rooms/" + bob.roomId + "/control", controlBody).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
    }

    @Test
    void theOldDevicesJoinDoesNotReturnToTheSeat() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        Client device = new Client();
        alice.approve(device.asked(alice.code, "Bob"));

        bob.ask(alice.code, "Carol").andExpect(status().isNotFound());
        bob.postJson("/api/room-joins", bob.envelope("\"code\":\"" + alice.code + "\",\"name\":\"bob\""))
                .andExpect(status().is(422)).andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
    }

    @Test
    void theNewDeviceCommandsTheSeatAtTheNewGenerationFromSequenceOne() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        start(alice, bob);
        Client device = new Client();
        String id = device.asked(alice.code, "Bob");
        alice.approve(id);
        recovered(device, bob, id);
        device.connect();

        boolean deviceActs = device.view().get("game").get("hand").get("actorId").asString().equals(playerOf(device));
        (deviceActs ? device : alice).command("CALL", "{}").andExpect(jsonPath("$.outcome").value("APPLIED"));
    }

    @Test
    void aHostApprovingTheirOwnSeatSeesNothingAfterwards() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        Client device = new Client();
        String id = device.asked(alice.code, "Alice");

        alice.approve(id).andExpect(jsonPath("$.outcome").value("APPLIED"))
                .andExpect(jsonPath("$.latestState").value((Object) null));

        alice.state().andExpect(status().isNotFound());
        device.recovery(id).andExpect(status().isOk())
                .andExpect(jsonPath("$.state.you.participantId").value(alice.participantId))
                .andExpect(jsonPath("$.state.hostId").value(alice.participantId));
        assertThat(bob.view().get("hostId").asString()).isEqualTo(alice.participantId);
    }

    @Test
    void whoeverTookOverTheHostCanApproveTheOldHostsRecovery() throws Exception {
        Client alice = host();
        Client bob = bob(alice);
        start(alice, bob);
        registry.update(alice.roomId, room -> {
            RoomLifecycle.disconnected(room, "test-" + alice.participantId, new RoomEnv(CLOCK, IdGenerator.random()));
            return null;
        });
        CLOCK.advance(Duration.ofSeconds(60));
        registry.sweepAll();
        assertThat(bob.view().get("hostTakeoverOpen").asBoolean()).isTrue();
        bob.commandAt(bob.view(), "TAKE_HOST", "{}").andExpect(status().isOk());
        Client device = new Client();
        String id = device.asked(alice.code, "Alice");

        bob.approve(id);

        recovered(device, alice, id);
        device.state().andExpect(status().isOk())
                .andExpect(jsonPath("$.hostId").value(bob.participantId))
                .andExpect(jsonPath("$.you.participantId").value(alice.participantId));
        alice.state().andExpect(status().isNotFound());
    }
}
