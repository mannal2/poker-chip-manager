package xyz.jwlee.poker.server.registry;

import java.security.SecureRandom;
import java.util.Optional;
import java.util.Random;
import java.util.Set;

// 헷갈리는 글자를 뺀 방 코드를 만들고 정규화한다
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

    // 이미 쓰인 코드와 겹치지 않는 새 방 코드를 뽑는다
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

    // 입력을 대문자 방 코드로 정규화하고, 형식이 유효하지 않으면 빈 Optional을 반환한다
    /** The canonical upper-case form of user input, or empty when it cannot be a code. */
    public static Optional<String> normalize(String input) {
        if (input == null) {
            return Optional.empty();
        }
        // ASCII-only case fold: Unicode aliases such as the sharp s must not turn into letters.
        String trimmed = input.trim();
        StringBuilder folded = new StringBuilder(trimmed.length());
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            folded.append(c >= 'a' && c <= 'z' ? (char) (c - 32) : c);
        }
        String code = folded.toString();
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
