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

// 바이인 신청·조회 HTTP 경로와 승인 뒤 새 기기의 입장을 검사한다
@SpringBootTest
@AutoConfigureMockMvc
@Import(BuyInControllerTest.Timed.class)
class BuyInControllerTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-11-21T00:00:00Z"));

    // 테스트가 직접 진행시키는 시계를 넣는다
    @TestConfiguration(proxyBeanMethods = false)
    static class Timed {
        // 바이인 시나리오용 고정 시계를 만든다
        @Bean
        @Primary
        Clock buyInClock() {
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

        // 세션과 CSRF를 갖춘 테스트용 클라이언트를 만든다
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

        // 바이인을 신청한다
        ResultActions ask(String roomCode, String name) throws Exception {
            return postJson("/api/buy-in-requests", envelope("\"roomCode\":\"" + roomCode + "\",\"name\":\"" + name
                    + "\""));
        }

        // 바이인을 신청하고 신청 ID를 돌려준다
        String asked(String roomCode, String name) throws Exception {
            return body(ask(roomCode, name).andExpect(status().isCreated())).get("buyInRequestId").asString();
        }

        // 신청 결과를 조회한다
        ResultActions buyIn(String id) throws Exception {
            return read("/api/buy-in-requests/" + id);
        }

        // 이 방의 상태를 조회한다
        ResultActions state() throws Exception {
            return read("/api/rooms/" + roomId + "/state");
        }

        // 지금 보이는 상태를 읽는다
        JsonNode view() throws Exception {
            return body(state().andExpect(status().isOk()));
        }

        // 최신 상태 기준으로 명령을 보낸다
        ResultActions command(String type, String payload) throws Exception {
            JsonNode view = view();
            long n = ++sequence;
            StringBuilder json = new StringBuilder("{\"protocolVersion\":1,\"requestId\":\"").append(participantId)
                    .append('-').append(n).append("\",\"sequence\":").append(n)
                    .append(",\"controlGeneration\":1,\"expectedStateVersion\":")
                    .append(view.get("stateVersion").asLong()).append(",\"type\":\"").append(type)
                    .append("\",\"payload\":").append(payload);
            if (!view.get("tournamentId").isNull()) {
                json.append(",\"tournamentId\":\"").append(view.get("tournamentId").asString()).append('"');
            }
            return postJson("/api/rooms/" + roomId + "/commands", json.append('}').toString())
                    .andExpect(status().isOk());
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

    // Alice가 방을 만들고 Bob과 게임을 시작한다
    private Client playing() throws Exception {
        Client alice = new Client().create("Alice");
        Client bob = new Client().join(alice.code, "Bob");
        alice.connect();
        bob.connect();
        alice.command("SET_DEALER", "{\"participantId\":\"" + alice.participantId + "\"}");
        alice.command("START", "{}");
        return alice;
    }

    // 대기실 방에는 바이인을 신청할 수 없는지 확인한다
    @Test
    void aWaitingRoomRefusesABuyIn() throws Exception {
        Client alice = new Client().create("Alice");

        new Client().ask(alice.code, "Erin").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("BUY_IN_CLOSED"))
                .andExpect(jsonPath("$.message").value("지금은 바이인을 받을 수 없습니다."));
    }

    // 진행 중인 방의 신청이 식별자·대기 상태·만료 시각을 돌려주고 재시도해도 하나만 만드는지 확인한다
    @Test
    void aRequestAnswersIdPendingAndExpiryAndARetryMakesOnlyOne() throws Exception {
        Client alice = playing();
        Client device = new Client();
        String request = device.envelope("\"roomCode\":\"" + alice.code + "\",\"name\":\"Erin\"");

        JsonNode first = body(device.postJson("/api/buy-in-requests", request).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.expiresAt").value(CLOCK.instant().plus(Duration.ofMinutes(5)).toString()))
                .andExpect(r -> assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("no-store")));
        JsonNode again = body(device.postJson("/api/buy-in-requests", request).andExpect(status().isCreated()));

        assertThat(first.propertyNames()).containsExactlyInAnyOrder("buyInRequestId", "status", "expiresAt");
        assertThat(again.get("buyInRequestId")).isEqualTo(first.get("buyInRequestId"));
        assertThat(alice.view().get("buyInRequests")).hasSize(1);
    }

    // 같은 이름·없는 방·이미 앉은 세션의 신청이 거절되는지 확인한다
    @Test
    void aDuplicateNameAMissingRoomAndASeatedSessionAreRefused() throws Exception {
        Client alice = playing();

        new Client().ask(alice.code, "bob").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("DUPLICATE_NAME"));
        new Client().ask("ZZZZZZ", "Erin").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));
        alice.ask(alice.code, "Erin").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("ALREADY_PARTICIPANT"));
        new Client().postJson("/api/buy-in-requests", "{}").andExpect(status().isBadRequest());
    }

    // 승인 전에는 자리가 없고, 승인 뒤 조회가 세션을 새 참가자로 연결하는지 확인한다
    @Test
    void theReadAfterApprovalLinksTheSessionToTheNewParticipant() throws Exception {
        Client alice = playing();
        Client device = new Client();
        String id = device.asked(alice.code, "Erin");
        device.roomId = alice.roomId;

        device.buyIn(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.participantId").doesNotExist());
        new Client().buyIn(id).andExpect(status().isNotFound());
        alice.buyIn(id).andExpect(status().isNotFound());
        device.state().andExpect(status().isNotFound());

        String last = alice.view().get("game").get("players").get(1).get("id").asString();
        alice.command("BUY_IN_APPROVE", "{\"buyInRequestId\":\"" + id + "\",\"placement\":{\"kind\":\"between\","
                + "\"after\":\"" + last + "\"}}").andExpect(jsonPath("$.outcome").value("APPLIED"));

        JsonNode first = body(device.buyIn(id).andExpect(status().isOk())
                .andExpect(jsonPath("$.buyInRequestId").value(id))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.roomId").value(alice.roomId))
                .andExpect(jsonPath("$.code").value(alice.code))
                .andExpect(jsonPath("$.controlGeneration").value(1))
                .andExpect(jsonPath("$.state.you.participantId").isString()));
        assertThat(body(device.buyIn(id))).isEqualTo(first);
        device.participantId = first.get("participantId").asString();

        JsonNode seen = device.view();
        assertThat(seen.get("participants")).hasSize(3);
        assertThat(seen.get("participants").get(2).get("playerId").asString()).isEqualTo("p2");
        assertThat(seen.toString()).doesNotContain("credential");
    }

    // 거절된 신청은 자리를 주지 않는지 확인한다
    @Test
    void aRejectedRequestGivesNoSeat() throws Exception {
        Client alice = playing();
        Client device = new Client();
        String id = device.asked(alice.code, "Erin");
        device.roomId = alice.roomId;

        alice.command("BUY_IN_REJECT", "{\"buyInRequestId\":\"" + id + "\"}");

        device.buyIn(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.participantId").doesNotExist());
        device.state().andExpect(status().isNotFound());
        assertThat(alice.view().get("buyInRequests")).isEmpty();
    }

    // 취소된 바이인의 승인은 자리를 열지 않는지 확인한다
    @Test
    void aCancelledBuyInsApprovalOpensNothing() throws Exception {
        Client alice = playing();
        Client device = new Client();
        String id = device.asked(alice.code, "Erin");
        device.roomId = alice.roomId;
        alice.command("BUY_IN_APPROVE", "{\"buyInRequestId\":\"" + id + "\",\"placement\":{\"kind\":\"between\","
                + "\"after\":\"p1\"}}");

        alice.command("CANCEL_BUY_IN", "{\"playerId\":\"p2\"}").andExpect(jsonPath("$.outcome").value("APPLIED"));

        device.buyIn(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SUPERSEDED"));
        device.state().andExpect(status().isNotFound());
        assertThat(alice.view().get("participants")).hasSize(2);
    }

    // 신청이 제 시각에 만료로 보이는지 확인한다
    @Test
    void aRequestShowsExpiredAtItsTime() throws Exception {
        Client alice = playing();
        Client device = new Client();
        String id = device.asked(alice.code, "Erin");

        CLOCK.advance(Duration.ofMinutes(5));

        device.buyIn(id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("EXPIRED"));
    }
}
