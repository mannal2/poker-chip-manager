package xyz.jwlee.poker.server.registry;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Random;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RoomCodesTest {

    private static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    @Test
    void alphabetHasThirtyOneCharacters() {
        assertThat(ALPHABET).hasSize(31);
    }

    @Test
    void generatedCodesUseSixCharactersOfTheAlphabetOnly() {
        RoomCodes codes = new RoomCodes();
        for (int i = 0; i < 500; i++) {
            assertThat(codes.next(Set.of())).hasSize(6).matches("[" + ALPHABET + "]{6}");
        }
    }

    @Test
    void aTakenCodeIsRetried() {
        // Scripted draws: the first six pick "AAAAAA" (taken), the next six pick "BBBBBB".
        int[] draws = {0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1};
        Random scripted = new Random() {
            private int i;

            @Override
            public int nextInt(int bound) {
                return draws[i++];
            }
        };
        assertThat(new RoomCodes(scripted).next(new HashSet<>(Set.of("AAAAAA")))).isEqualTo("BBBBBB");
    }

    @Test
    void normalizeUppercasesAndTrimsValidInput() {
        assertThat(RoomCodes.normalize(" abcd23 ")).contains("ABCD23");
    }

    @Test
    void normalizeRejectsWrongLengthAndForeignCharacters() {
        assertThat(RoomCodes.normalize("ABCDE")).isEmpty();
        assertThat(RoomCodes.normalize("ABCDEFG")).isEmpty();
        assertThat(RoomCodes.normalize("ABCDE0")).isEmpty(); // 0 is not in the alphabet
        assertThat(RoomCodes.normalize("ABCDEI")).isEmpty(); // neither is I
        assertThat(RoomCodes.normalize(null)).isEmpty();
    }
}
