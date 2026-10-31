package xyz.jwlee.poker.server.realtime;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import xyz.jwlee.poker.server.auth.WebSocketHandshakeGuard;

// /ws 경로에 소켓 처리기와 핸드셰이크 검사를 연결한다
@Configuration(proxyBeanMethods = false)
@EnableWebSocket
class RealtimeConfig implements WebSocketConfigurer {

    private final RoomSocketHandler handler;
    private final WebSocketHandshakeGuard guard;

    RealtimeConfig(RoomSocketHandler handler, WebSocketHandshakeGuard guard) {
        this.handler = handler;
        this.guard = guard;
    }

    // 소켓 처리기를 등록한다. 지정하지 않으면 Spring이 같은 출처만 허용하므로 허용 목록을 넘긴다
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws").addInterceptors(guard).setAllowedOrigins(guard.allowedOrigins());
    }
}
