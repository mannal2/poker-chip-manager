package xyz.jwlee.poker.server.support;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// 시계와 id 생성기 빈을 등록하는 설정
@Configuration(proxyBeanMethods = false)
public class TimeConfig {

    // UTC 시스템 시계를 등록한다
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    // 무작위 id 생성기를 등록한다
    @Bean
    IdGenerator idGenerator() {
        return IdGenerator.random();
    }
}
