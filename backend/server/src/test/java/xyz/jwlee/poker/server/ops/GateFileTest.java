package xyz.jwlee.poker.server.ops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeFalse;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import xyz.jwlee.poker.server.api.GameClient;
import xyz.jwlee.poker.server.registry.RoomRegistry;

// 차단 파일 판정과 닫힌 파일로 기동한 서버의 시작 거절을 검사한다
@SpringBootTest
@AutoConfigureMockMvc
class GateFileTest {

    // 미완료 배포 파일을 만들어 서버가 그 파일로 기동하게 한다
    @DynamicPropertySource
    static void closedGateFile(DynamicPropertyRegistry properties) throws IOException {
        Path file = Files.createTempFile("start-gate", ".json");
        file.toFile().deleteOnExit();
        Files.writeString(file, "{\"deploymentId\":\"d9\",\"phase\":\"SWAPPING\"}");
        properties.add("poker.deploy.gate-file", file::toString);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    RoomRegistry registry;

    @TempDir
    Path dir;

    // 만든 방을 지운다
    @AfterEach
    void clearRooms() {
        registry.roomIds().forEach(registry::remove);
    }

    // 내용을 쓴 차단 파일을 읽는다
    private GateFile.State readWith(String content) throws IOException {
        Path file = dir.resolve("start-gate.json");
        Files.writeString(file, content);
        return GateFile.read(file);
    }

    // 파일이 없으면 열린 상태인지 확인한다
    @Test
    void noFileIsOpen() {
        assertThat(GateFile.read(dir.resolve("missing.json")).closed()).isFalse();
    }

    // 완료 단계 파일은 열린 상태인지 확인한다
    @Test
    void aCompletedDeploymentIsOpen() throws IOException {
        assertThat(readWith("{\"deploymentId\":\"d1\",\"phase\":\"COMPLETE\"}").closed()).isFalse();
    }

    // 진행 단계 파일은 그 배포 식별자로 닫히는지 확인한다
    @Test
    void anUnfinishedDeploymentIsClosedWithItsId() throws IOException {
        GateFile.State state = readWith("{\"deploymentId\":\"d1\",\"phase\":\"PREPARED\"}");

        assertThat(state.closed()).isTrue();
        assertThat(state.deploymentId()).isEqualTo("d1");
    }

    // 식별자가 없는 완료 파일은 닫히고 식별자를 unknown으로 두는지 확인한다
    @Test
    void completeWithoutAnIdIsClosedAsUnknown() throws IOException {
        GateFile.State state = readWith("{\"phase\":\"COMPLETE\"}");

        assertThat(state.closed()).isTrue();
        assertThat(state.deploymentId()).isEqualTo("unknown");
    }

    // 깨진 JSON과 객체가 아닌 값은 unknown으로 닫히는지 확인한다
    @Test
    void brokenContentIsClosedAsUnknown() throws IOException {
        for (String content : new String[] {"{\"deploymentId\":", "", "[]", "\"COMPLETE\"",
                "{\"deploymentId\":\"d1\",\"phase\":\"COMPLETE\"} trailing"}) {
            GateFile.State state = readWith(content);

            assertThat(state.closed()).as(content).isTrue();
            assertThat(state.deploymentId()).as(content).isEqualTo("unknown");
        }
    }

    // 파일 자리의 디렉터리처럼 읽을 수 없는 경로는 닫히는지 확인한다
    @Test
    void aPathThatCannotBeReadIsClosed() {
        GateFile.State state = GateFile.read(dir);

        assertThat(state.closed()).isTrue();
        assertThat(state.deploymentId()).isEqualTo("unknown");
    }

    // 읽기 권한이 없는 파일은 닫히는지 확인한다
    @Test
    void aFileWithoutReadPermissionIsClosed() throws IOException {
        assumeTrue(FileSystems.getDefault().supportedFileAttributeViews().contains("posix"));
        Path file = dir.resolve("secret.json");
        Files.writeString(file, "{\"deploymentId\":\"d1\",\"phase\":\"COMPLETE\"}");
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("---------"));
        assumeFalse(Files.isReadable(file));

        assertThat(GateFile.read(file).closed()).isTrue();
    }

    // 닫힌 파일로 기동한 서버는 START를 거절하고 스냅샷과 상태로 알리는지 확인한다
    @Test
    void aServerStartedWithAClosedFileRefusesToStart() throws Exception {
        GameClient[] c = GameClient.room(mvc, registry, "Alice", "Bob");
        c[0].send("SET_DEALER", "{\"participantId\":\"" + c[0].participantId + "\"}").andExpect(status().isOk());

        c[0].send("START", "{}").andExpect(status().is(422)).andExpect(jsonPath("$.code").value("DEPLOY_PENDING"));

        assertThat(c[0].refresh().get("deployPending").asBoolean()).isTrue();
        mvc.perform(get("/internal/deploy/status")).andExpect(status().isOk())
                .andExpect(jsonPath("$.startsClosed").value(true))
                .andExpect(jsonPath("$.deploymentId").value("d9"));
    }
}
