package xyz.jwlee.poker.server.support;

import java.util.UUID;

/** Source of unique ids; injectable so tests can make ids deterministic. */
public interface IdGenerator {

    String next();

    static IdGenerator random() {
        return () -> UUID.randomUUID().toString();
    }
}
