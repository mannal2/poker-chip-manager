package xyz.jwlee.poker.server.api;

import java.util.Map;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import xyz.jwlee.poker.server.support.Protocol;

@RestController
class HealthController {

    private final String version;

    HealthController(BuildProperties build) {
        this.version = build.getVersion();
    }

    @GetMapping("/api/health")
    Map<String, Object> health() {
        return Map.of("status", "UP", "protocolVersion", Protocol.VERSION, "version", version);
    }
}
