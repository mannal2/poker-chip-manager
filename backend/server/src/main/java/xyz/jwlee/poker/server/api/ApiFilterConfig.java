package xyz.jwlee.poker.server.api;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

// API 경로에 본문 크기 필터를 등록하는 설정
@Configuration(proxyBeanMethods = false)
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
}
