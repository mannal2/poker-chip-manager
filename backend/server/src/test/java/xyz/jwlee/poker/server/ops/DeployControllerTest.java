package xyz.jwlee.poker.server.ops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import xyz.jwlee.poker.server.api.GameClient;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.StartGate;

// 내부 배포 경로의 준비·상태·해제와 게이트가 명령에 주는 영향을 HTTP로 검사한다
@SpringBootTest
@AutoConfigureMockMvc
class DeployControllerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final RequestPostProcessor REMOTE = request -> {
        request.setRemoteAddr("10.0.0.5");
        return request;
    };

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    @Autowired
    StartGate gate;

    // 게이트를 열고 방을 지워 다음 테스트에 남기지 않는다
    @AfterEach
    void reset() {
        gate.deploymentId().ifPresent(gate::open);
        registry.roomIds().forEach(registry::remove);
    }

    // CSRF·Origin·세션 없이 내부 경로에 JSON을 보낸다
    private ResultActions internalPost(String path, String json) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(json));
    }

    // 배포 준비를 요청한다
    private ResultActions prepare(String deploymentId) throws Exception {
        return internalPost("/internal/deploy/prepare", "{\"deploymentId\":\"" + deploymentId + "\"}");
    }

    // 현재 상태 응답을 읽는다
    private JsonNode deployStatus() throws Exception {
        return MAPPER.readTree(mvc.perform(get("/internal/deploy/status")).andExpect(status().isOk()).andReturn()
                .getResponse().getContentAsString());
    }

    // 지금 프로세스 식별로 해제를 요청한다
    private ResultActions release(String deploymentId) throws Exception {
        return release(deploymentId, deployStatus().get("processId").asString());
    }

    // 지정한 프로세스 식별로 해제를 요청한다
    private ResultActions release(String deploymentId, String processId) throws Exception {
        return internalPost("/internal/deploy/release",
                "{\"deploymentId\":\"" + deploymentId + "\",\"processId\":\"" + processId + "\"}");
    }

    // 딜러를 정해 시작만 남은 방을 만든다
    private GameClient[] waitingTable(String... names) throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, names);
        c[0].send("SET_DEALER", "{\"participantId\":\"" + c[0].participantId + "\"}").andExpect(status().isOk());
        return c;
    }

    // 게임이 시작된 방을 만든다
    private GameClient[] startedTable(String... names) throws Exception {
        GameClient[] c = waitingTable(names);
        c[0].send("START", "{}").andExpect(status().isOk());
        return c;
    }

    // 지금 차례인 사람을 찾는다
    private static GameClient actor(GameClient[] c) throws Exception {
        String actorId = c[0].refresh().get("game").get("hand").get("actorId").asString();
        for (GameClient client : c) {
            client.refresh();
            if (actorId.equals(client.playerId())) {
                return client;
            }
        }
        throw new AssertionError("nobody is " + actorId);
    }

    // 두 사람의 올인으로 끝난 결과 화면을 만든다
    private GameClient[] finishedTable() throws Exception {
        GameClient[] c = startedTable("Alice", "Bob");
        actor(c).send("ALL_IN", null).andExpect(status().isOk());
        actor(c).send("CALL", null).andExpect(status().isOk());
        c[0].send("SETTLE_HAND", "{\"winners\":{\"pot0\":[\"p1\"]}}").andExpect(status().isOk());
        assertThat(c[0].refresh().get("roomPhase").asString()).isEqualTo("RESULT");
        return c;
    }

    // 진행 게임이 있으면 보류되고 다른 방의 새 게임은 계속 시작되는지 확인한다
    @Test
    void aRunningGameHoldsTheDeploymentAndNewGamesStillStart() throws Exception {
        startedTable("Alice", "Bob");
        GameClient[] other = waitingTable("Carol", "Dave");

        prepare("d1").andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("HELD"))
                .andExpect(jsonPath("$.activeTournaments").value(1))
                .andExpect(jsonPath("$.processId").isNotEmpty());

        JsonNode now = deployStatus();
        assertThat(now.get("startsClosed").asBoolean()).isFalse();
        assertThat(now.get("deploymentId").isNull()).isTrue();
        assertThat(now.get("activeTournaments").asInt()).isEqualTo(1);
        assertThat(now.get("rooms").asInt()).isEqualTo(2);
        other[0].send("START", "{}").andExpect(status().isOk());
    }

    // 보류된 준비가 대기방의 버전과 안내를 건드리지 않는지 확인한다
    @Test
    void aHeldDeploymentLeavesWaitingRoomsAlone() throws Exception {
        startedTable("Alice", "Bob");
        GameClient[] other = waitingTable("Carol", "Dave");
        long version = other[0].refresh().get("stateVersion").asLong();

        prepare("d1").andExpect(jsonPath("$.result").value("HELD"));

        assertThat(other[0].refresh().get("stateVersion").asLong()).isEqualTo(version);
        assertThat(other[0].state.get("deployPending").asBoolean()).isFalse();
    }

    // 대기방만 있으면 준비되고 START가 막히며 해제 뒤 시작되는지 확인한다
    @Test
    void waitingRoomsAreReadyStartIsRefusedAndReleaseLetsItStart() throws Exception {
        GameClient[] c = waitingTable("Alice", "Bob");
        long version = c[0].refresh().get("stateVersion").asLong();

        prepare("d1").andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("READY"))
                .andExpect(jsonPath("$.activeTournaments").value(0));

        assertThat(c[0].refresh().get("deployPending").asBoolean()).isTrue();
        assertThat(c[0].state.get("stateVersion").asLong()).isEqualTo(version + 1);
        c[0].send("START", "{}").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("DEPLOY_PENDING"))
                .andExpect(jsonPath("$.outcome").value("REJECTED"));
        JsonNode now = deployStatus();
        assertThat(now.get("startsClosed").asBoolean()).isTrue();
        assertThat(now.get("deploymentId").asString()).isEqualTo("d1");

        release("d1").andExpect(status().isOk());

        assertThat(c[0].refresh().get("deployPending").asBoolean()).isFalse();
        assertThat(c[0].state.get("stateVersion").asLong()).isEqualTo(version + 2);
        c[0].send("START", "{}").andExpect(status().isOk());
    }

    // 결과 화면은 배포를 막지 않는지 확인한다
    @Test
    void aResultScreenDoesNotHoldTheDeployment() throws Exception {
        finishedTable();

        prepare("d1").andExpect(jsonPath("$.result").value("READY"));
    }

    // 다른 배포가 닫아 둔 동안의 준비는 409이고 같은 배포의 재시도는 READY인지 확인한다
    @Test
    void anotherDeploymentIsRefusedAndTheSameOneMayRetry() throws Exception {
        prepare("d1").andExpect(jsonPath("$.result").value("READY"));

        prepare("d2").andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DEPLOY_IN_PROGRESS"));
        prepare("d1").andExpect(status().isOk()).andExpect(jsonPath("$.result").value("READY"));
    }

    // 프로세스나 배포 식별이 틀린 해제는 409이고 게이트가 닫힌 채인지 확인한다
    @Test
    void releaseWithTheWrongIdentityIsRefused() throws Exception {
        prepare("d1").andExpect(jsonPath("$.result").value("READY"));

        release("d1", "another-process").andExpect(status().isConflict());
        release("d2").andExpect(status().isConflict());

        assertThat(gate.deploymentId()).contains("d1");
    }

    // 프로세스 식별이 응답마다 같고 해제를 반복해도 성공하는지 확인한다
    @Test
    void theProcessIdIsStableAndReleaseCanBeRepeated() throws Exception {
        JsonNode prepared = MAPPER.readTree(prepare("d1").andReturn().getResponse().getContentAsString());

        assertThat(prepared.get("processId").asString()).isEqualTo(deployStatus().get("processId").asString());
        release("d1").andExpect(status().isOk());
        release("d1").andExpect(status().isOk());
    }

    // 식별이 없거나 빈 요청은 400이고 게이트를 건드리지 않는지 확인한다
    @Test
    void aMissingIdentityIsInvalid() throws Exception {
        internalPost("/internal/deploy/prepare", "{}").andExpect(status().isBadRequest());
        prepare(" ").andExpect(status().isBadRequest());
        internalPost("/internal/deploy/release", "{\"deploymentId\":\"d1\"}").andExpect(status().isBadRequest());

        assertThat(gate.isClosed()).isFalse();
    }

    // 비loopback 요청은 전달 헤더가 있어도 404이고 게이트를 건드리지 못하는지 확인한다
    @Test
    void aNonLoopbackRequestIs404EvenWithForwardedHeaders() throws Exception {
        mvc.perform(post("/internal/deploy/prepare").with(REMOTE).header("X-Real-IP", "127.0.0.1")
                .header("X-Forwarded-For", "127.0.0.1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"deploymentId\":\"d1\"}")).andExpect(status().isNotFound());
        mvc.perform(get("/internal/deploy/status").with(REMOTE).header("X-Real-IP", "127.0.0.1"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/internal/deploy/release").with(REMOTE).header("X-Real-IP", "127.0.0.1"))
                .andExpect(status().isNotFound());

        assertThat(gate.isClosed()).isFalse();
    }

    // loopback 요청은 다른 Origin이어도 CSRF·세션 없이 동작하는지 확인한다
    @Test
    void aLoopbackRequestNeedsNoCsrfOriginOrSession() throws Exception {
        mvc.perform(post("/internal/deploy/prepare").header("Origin", "https://evil.example")
                .contentType(MediaType.APPLICATION_JSON).content("{\"deploymentId\":\"d1\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.result").value("READY"));
    }

    // 공개 경로의 Origin 검사는 그대로인지 확인한다
    @Test
    void publicPathsStayProtected() throws Exception {
        mvc.perform(post("/api/rooms").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ORIGIN_REJECTED"));
    }

    // 닫힌 동안 결과 화면의 UNDO만 거절되고 해제 뒤 되돌릴 수 있는지 확인한다
    @Test
    void undoOnTheResultScreenWaitsForTheRelease() throws Exception {
        GameClient[] c = finishedTable();
        prepare("d1").andExpect(jsonPath("$.result").value("READY"));

        c[0].send("UNDO", "{}").andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("UNDO_DEPLOY_PENDING"));
        assertThat(c[0].refresh().get("roomPhase").asString()).isEqualTo("RESULT");

        release("d1").andExpect(status().isOk());
        c[0].send("UNDO", "{}").andExpect(status().isOk());
        assertThat(c[0].refresh().get("roomPhase").asString()).isEqualTo("PLAYING");
    }

    // 닫힌 동안에도 진행 중인 게임의 베팅과 되돌리기는 계속되는지 확인한다
    @Test
    void aRunningGameKeepsPlayingWhileTheGateIsClosed() throws Exception {
        GameClient[] c = startedTable("Alice", "Bob", "Carol");
        gate.close("d1");

        actor(c).send("CALL", null).andExpect(status().isOk());
        c[0].send("UNDO", "{}").andExpect(status().isOk());
        actor(c).send("FOLD", null).andExpect(status().isOk());
    }
}
