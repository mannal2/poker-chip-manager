package xyz.jwlee.poker.server.support;

import java.util.UUID;

// 고유 id를 만들어 주는 생성기
/** Source of unique ids; injectable so tests can make ids deterministic. */
public interface IdGenerator {

    // 새 고유 id를 만든다
    String next();

    // 무작위 UUID를 만드는 생성기를 돌려준다
    static IdGenerator random() {
        return () -> UUID.randomUUID().toString();
    }
}
