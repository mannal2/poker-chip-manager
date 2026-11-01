package xyz.jwlee.poker.server.ops;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import xyz.jwlee.poker.server.room.StartGate;

// 배포 스크립트가 남긴 시작 차단 파일을 읽어 게이트의 처음 상태를 정한다
/**
 * The gate survives a restart through this file. Anything but "no file" or a finished deployment closes the gate:
 * a backend that cannot tell whether a deployment is under way must not accept new games (DEPLOYMENT_SPEC 4).
 */
public final class GateFile {

    private static final Logger LOG = LoggerFactory.getLogger(GateFile.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String COMPLETE = "COMPLETE";
    private static final String UNKNOWN = "unknown";

    // 파일이 말하는 게이트 상태와 닫은 배포의 식별자
    public record State(boolean closed, String deploymentId) {
        static final State OPEN = new State(false, null);

        // 주어진 배포가 닫은 상태를 만든다
        static State closedBy(String deploymentId) {
            return new State(true, deploymentId);
        }
    }

    // 기동할 때 파일대로 닫거나 연 게이트를 빈으로 등록한다
    @Configuration(proxyBeanMethods = false)
    static class Startup {

        // 요청을 받기 전에 파일을 읽어 게이트를 만든다
        @Bean
        StartGate startGate(@Value("${poker.deploy.gate-file:}") String gateFile) {
            StartGate gate = new StartGate();
            State state = gateFile.isBlank() ? State.OPEN : read(Path.of(gateFile));
            if (state.closed()) {
                gate.close(state.deploymentId());
                LOG.warn("New games stay closed until deployment {} is released", state.deploymentId());
            }
            return gate;
        }
    }

    private GateFile() {}

    // 파일을 읽어 게이트 상태를 판정한다. 없는 파일과 완료 기록만 열린 상태다
    public static State read(Path path) {
        try {
            return judge(JSON.readTree(Files.readAllBytes(path)));
        } catch (NoSuchFileException e) {
            return State.OPEN;
        } catch (IOException | RuntimeException e) {
            LOG.warn("Cannot read the start gate file {}: {}", path, e.getClass().getSimpleName());
            return State.closedBy(UNKNOWN);
        }
    }

    // 읽은 값이 완료 기록이면 열고 그 밖에는 닫는다
    private static State judge(JsonNode file) {
        JsonNode id = file.get("deploymentId");
        boolean named = id != null && id.isString() && !id.asString().isBlank();
        JsonNode phase = file.get("phase");
        if (named && phase != null && phase.isString() && phase.asString().equals(COMPLETE)) {
            return State.OPEN;
        }
        return State.closedBy(named ? id.asString() : UNKNOWN);
    }
}
