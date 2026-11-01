package xyz.jwlee.poker.server.auth;

import java.util.Set;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

// 로그인 없이 세션 쿠키, CSRF, Origin 검사로 요청을 보호하는 보안 설정
/**
 * No login: every /api request is allowed, and the session cookie plus a CSRF header and an Origin
 * allow-list protect state-changing requests. Errors are JSON, never redirects.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthProperties.class)
class SecurityConfig {

    // 내부 경로에는 브라우저용 검사를 걸지 않는 체인을 먼저 맞춘다
    /** Browser checks mean nothing to a local script; {@code LoopbackOnlyFilter} has already run before this chain. */
    @Bean
    @Order(1)
    SecurityFilterChain internalFilterChain(HttpSecurity http) {
        http.securityMatcher("/internal/**")
                .authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .formLogin(f -> f.disable())
                .httpBasic(b -> b.disable())
                .logout(l -> l.disable())
                .requestCache(c -> c.disable())
                .csrf(c -> c.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        return http.build();
    }

    // CSRF, Origin, 세션 필터와 JSON 오류 응답을 갖춘 보안 필터 체인을 만든다
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AuthProperties props) {
        // The repository's default header name is X-CSRF-TOKEN. The plain (non-XOR) handler keeps the
        // token the session endpoint returns equal to the one the filter accepts.
        http.authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .formLogin(f -> f.disable())
                .httpBasic(b -> b.disable())
                .logout(l -> l.disable())
                .requestCache(c -> c.disable())
                .csrf(c -> c.csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .addFilterBefore(new OriginFilter(Set.copyOf(props.allowedOrigins())), CsrfFilter.class)
                .addFilterBefore(new SessionGuardFilter(), CsrfFilter.class)
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> JsonErrors.write(res, 401, "NO_SESSION"))
                        .accessDeniedHandler((req, res, ex) -> JsonErrors.write(
                                res, 403, ex instanceof CsrfException ? "CSRF_REJECTED" : "FORBIDDEN")));
        return http.build();
    }

    // 빈 사용자 저장소를 등록해 기본 사용자 생성을 막는다
    // An empty user store stops Boot from generating a default user and logging its password.
    @Bean
    UserDetailsService userDetailsService() {
        return new InMemoryUserDetailsManager();
    }
}
