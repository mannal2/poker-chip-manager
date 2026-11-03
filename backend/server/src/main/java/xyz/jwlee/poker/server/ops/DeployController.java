package xyz.jwlee.poker.server.ops;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import xyz.jwlee.poker.server.registry.RoomRegistry;
import xyz.jwlee.poker.server.room.RoomException;

// 배포 스크립트가 쓰는 내부 준비·상태·해제 경로
/**
 * Reached only from loopback, see {@link LoopbackOnlyFilter}. {@code processId} is new for every process, so a
 * script can tell that the server it prepared is still the one it is about to replace or release.
 */
@RestController
class DeployController {

    private static final int MAX_ID_LENGTH = 128;

    private final RoomRegistry registry;
    private final String processId = UUID.randomUUID().toString();

    // 방 레지스트리를 주입받는다
    DeployController(RoomRegistry registry) {
        this.registry = registry;
    }

    // 게이트를 닫고 진행 게임이 없으면 READY, 있으면 다시 열고 HELD를 돌려준다
    @PostMapping("/internal/deploy/prepare")
    Map<String, Object> prepare(@RequestBody(required = false) JsonNode body) {
        RoomRegistry.PrepareResult prepared = registry.prepareDeployment(identity(body, "deploymentId"));
        return Map.of("result", prepared.ready() ? "READY" : "HELD", "processId", processId,
                "activeTournaments", prepared.activeTournaments());
    }

    // 프로세스 식별, 게이트, 진행 게임 수를 한 시점으로 돌려준다
    @GetMapping("/internal/deploy/status")
    Map<String, Object> status() {
        RoomRegistry.DeploymentStatus now = registry.deploymentStatus();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("processId", processId);
        out.put("startsClosed", now.deploymentId().isPresent());
        out.put("deploymentId", now.deploymentId().orElse(null));
        out.put("activeTournaments", now.activeTournaments());
        out.put("rooms", now.rooms());
        return out;
    }

    // 프로세스와 배포 식별이 맞을 때만 게이트를 연다
    @PostMapping("/internal/deploy/release")
    Map<String, Object> release(@RequestBody(required = false) JsonNode body) {
        String deploymentId = identity(body, "deploymentId");
        if (!processId.equals(identity(body, "processId")) || !registry.releaseDeployment(deploymentId)) {
            throw new RoomException("DEPLOY_MISMATCH");
        }
        return Map.of("result", "RELEASED", "processId", processId);
    }

    // 본문에서 비어 있지 않은 식별 문자열을 꺼낸다
    private static String identity(JsonNode body, String field) {
        JsonNode value = body == null ? null : body.get(field);
        if (value == null || !value.isString() || value.asString().isBlank()
                || value.asString().length() > MAX_ID_LENGTH) {
            throw new RoomException("INVALID_INPUT");
        }
        return value.asString();
    }
}
