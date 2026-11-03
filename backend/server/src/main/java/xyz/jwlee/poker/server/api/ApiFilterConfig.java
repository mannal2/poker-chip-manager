package xyz.jwlee.poker.server.api;

import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

// API 경로에 본문 크기 필터와 빈도 제한 필터를 등록하는 설정
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(RateLimitProperties.class)
class ApiFilterConfig {

    // 본문 크기 제한 필터를 /api/* 에 가장 먼저 걸리도록 등록한다
    /** Runs before the security chain, so oversized bodies are never read by anything else. */
    @Bean
    FilterRegistrationBean<BodySizeFilter> bodySizeFilter() {
        FilterRegistrationBean<BodySizeFilter> bean = new FilterRegistrationBean<>(new BodySizeFilter());
        bean.addUrlPatterns("/api/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return bean;
    }

    // 빈도 제한 필터를 본문 크기 필터 다음, 보안 체인 앞에 등록한다
    @Bean
    @ConditionalOnProperty(value = "poker.rate-limit.enabled", matchIfMissing = true)
    FilterRegistrationBean<RateLimitFilter> rateLimitFilter(RateLimitProperties limits,
            @Value("${poker.client-ip-header:}") String clientIpHeader, Clock clock) {
        FilterRegistrationBean<RateLimitFilter> bean =
                new FilterRegistrationBean<>(new RateLimitFilter(limits, clientIpHeader, clock));
        bean.addUrlPatterns("/api/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        return bean;
    }
}
