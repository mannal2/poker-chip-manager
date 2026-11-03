package xyz.jwlee.poker.server.api;

import org.springframework.boot.context.properties.ConfigurationProperties;

// 요청 빈도 제한 설정
/** {@code poker.rate-limit}: per-session command limits and per-address entry and new-session limits. */
@ConfigurationProperties("poker.rate-limit")
record RateLimitProperties(double sessionPerSecond, int sessionBurst, double ipPerMinute, int ipBurst,
        double roomPerMinute, int roomBurst, double newSessionPerMinute, int newSessionBurst) {
}
