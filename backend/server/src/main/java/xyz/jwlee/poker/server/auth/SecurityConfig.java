package xyz.jwlee.poker.server.auth;

import java.util.Set;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

/**
 * No login: every /api request is allowed, and the session cookie plus a CSRF header and an Origin
 * allow-list protect state-changing requests. Errors are JSON, never redirects.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthProperties.class)
class SecurityConfig {

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
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((req, res, ex) -> JsonErrors.write(res, 401, "NO_SESSION"))
                        .accessDeniedHandler((req, res, ex) -> {
                            // No valid session id came with the request: the browser never opened a session.
                            if (!req.isRequestedSessionIdValid()) {
                                JsonErrors.write(res, 401, "NO_SESSION");
                            } else {
                                JsonErrors.write(res, 403, "CSRF_REJECTED");
                            }
                        }));
        return http.build();
    }

    // An empty user store stops Boot from generating a default user and logging its password.
    @Bean
    UserDetailsService userDetailsService() {
        return new InMemoryUserDetailsManager();
    }
}
