package xyz.jwlee.poker.server.support;

// 서버와 클라이언트가 맞춰야 하는 통신 프로토콜 버전
/** Wire protocol version shared by the health and session endpoints. */
public final class Protocol {

    public static final int VERSION = 1;

    private Protocol() {}
}
