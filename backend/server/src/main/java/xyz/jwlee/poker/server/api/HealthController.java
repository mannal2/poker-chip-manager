package xyz.jwlee.poker.server.api;

import java.util.Map;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {

    static final int PROTOCOL_VERSION = 1;

    private final String version;

    HealthController(BuildProperties build) {
        this.version = build.getVersion();
    }

    @GetMapping("/api/health")
    Map<String, Object> health() {
        return Map.of("status", "UP", "protocolVersion", PROTOCOL_VERSION, "version", version);
    }
}
