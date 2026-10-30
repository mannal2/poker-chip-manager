package xyz.jwlee.poker.server.auth;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code poker.allowed-origins}: the browser origins allowed to send state-changing requests. */
@ConfigurationProperties("poker")
record AuthProperties(List<String> allowedOrigins) {
    AuthProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }
}
