package xyz.jwlee.poker.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// 포커 서버 스프링 부트 애플리케이션
@SpringBootApplication
@EnableScheduling
public class PokerServerApplication {

    // 서버를 시작한다
    public static void main(String[] args) {
        SpringApplication.run(PokerServerApplication.class, args);
    }
}
