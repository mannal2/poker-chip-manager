package xyz.jwlee.poker.server.api;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

@Configuration(proxyBeanMethods = false)
class ApiFilterConfig {

    /** Runs before the security chain, so oversized bodies are never read by anything else. */
    @Bean
    FilterRegistrationBean<BodySizeFilter> bodySizeFilter() {
        FilterRegistrationBean<BodySizeFilter> bean = new FilterRegistrationBean<>(new BodySizeFilter());
        bean.addUrlPatterns("/api/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return bean;
    }
}
