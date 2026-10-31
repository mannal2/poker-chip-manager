package xyz.jwlee.poker.server.api;

import java.util.Map;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.jwlee.poker.server.support.Protocol;

// 서버 상태와 프로토콜/앱 버전을 알려주는 컨트롤러
@RestController
class HealthController {

    private final String version;

    HealthController(BuildProperties build) {
        this.version = build.getVersion();
    }

    // 서버 정상 여부와 버전 정보를 돌려준다
    @GetMapping("/api/health")
    Map<String, Object> health() {
        return Map.of("status", "UP", "protocolVersion", Protocol.VERSION, "version", version);
    }
}
