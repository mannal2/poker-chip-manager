package xyz.jwlee.poker.server.registry;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Optional;
import java.util.Random;
import java.util.Set;

/** Six-character room codes from an alphabet without look-alike characters (no 0 O 1 I L). */
public final class RoomCodes {

    static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    static final int LENGTH = 6;

    private final Random random;

    public RoomCodes() {
        this(new SecureRandom());
    }

    RoomCodes(Random random) {
        this.random = random;
    }

    /** A code not in {@code taken}; draws again on a collision. */
    public String next(Set<String> taken) {
        while (true) {
            StringBuilder b = new StringBuilder(LENGTH);
            for (int i = 0; i < LENGTH; i++) {
                b.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
            }
            String code = b.toString();
            if (!taken.contains(code)) {
                return code;
            }
        }
    }

    /** The canonical upper-case form of user input, or empty when it cannot be a code. */
    public static Optional<String> normalize(String input) {
        if (input == null) {
            return Optional.empty();
        }
        String code = input.trim().toUpperCase(Locale.ROOT);
        if (code.length() != LENGTH) {
            return Optional.empty();
        }
        for (int i = 0; i < LENGTH; i++) {
            if (ALPHABET.indexOf(code.charAt(i)) < 0) {
                return Optional.empty();
            }
        }
        return Optional.of(code);
    }
}
