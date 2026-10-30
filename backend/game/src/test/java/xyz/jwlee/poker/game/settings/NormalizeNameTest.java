package xyz.jwlee.poker.game.settings;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class NormalizeNameTest {

    @Test
    void trimsAndKeepsAValidName() {
        assertThat(SettingsValidator.normalizeName("  Alice 1 ")).contains("Alice 1");
    }

    @Test
    void composesToNfc() {
        // Decomposed Hangul jamo (NFD) of "가" becomes the single syllable.
        assertThat(SettingsValidator.normalizeName("\u1100\u1161")).contains("\uAC00");
    }

    @Test
    void rejectsEmptyTooLongAndForbiddenCharacters() {
        assertThat(SettingsValidator.normalizeName("   ")).isEqualTo(Optional.empty());
        assertThat(SettingsValidator.normalizeName("12345678901")).isEmpty();
        assertThat(SettingsValidator.normalizeName("a_b")).isEmpty();
        assertThat(SettingsValidator.normalizeName(null)).isEmpty();
    }
}
