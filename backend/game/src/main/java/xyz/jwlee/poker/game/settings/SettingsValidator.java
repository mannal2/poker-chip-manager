package xyz.jwlee.poker.game.settings;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import xyz.jwlee.poker.game.model.GameSettings;

public final class SettingsValidator {
    private static final Pattern NAME = Pattern.compile("^[가-힣a-zA-Z0-9 ]{1,10}$");
    private static final int MAX_CHIPS = 1_000_000;

    private SettingsValidator() {}

    /** Chip amounts are positive multiples of 5 up to 1,000,000. */
    public static boolean validChips(int n) {
        return n > 0 && n <= MAX_CHIPS && n % 5 == 0;
    }

    /** A name trimmed and NFC-normalized, or empty when it breaks the name rule (1-10 Hangul, Latin, digit or space). */
    public static Optional<String> normalizeName(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String name = Normalizer.normalize(raw.trim(), Normalizer.Form.NFC);
        return NAME.matcher(name).matches() ? Optional.of(name) : Optional.empty();
    }

    public static SettingsValidation validate(GameSettings input) {
        List<String> names = new ArrayList<>();
        boolean namesValid = true;
        for (String raw : input.names()) {
            Optional<String> name = normalizeName(raw);
            if (name.isPresent()) {
                names.add(name.get());
            } else {
                namesValid = false;
            }
        }
        Set<String> lowered = new HashSet<>();
        for (String n : names) {
            lowered.add(n.toLowerCase(Locale.ROOT));
        }
        if (names.size() < 2
                || names.size() > 10
                || !namesValid
                || lowered.size() != names.size()) {
            return new SettingsValidation.Invalid(SettingsErrorCode.INVALID_NAMES);
        }
        if (!validChips(input.initial())
                || !validChips(input.smallBlind())
                || !validChips(input.bigBlind())
                || input.smallBlind() >= input.bigBlind()
                || input.bigBlind() > input.initial()) {
            return new SettingsValidation.Invalid(SettingsErrorCode.INVALID_CHIP_SETTINGS);
        }
        if (input.button() < -1 || input.button() >= names.size()) {
            return new SettingsValidation.Invalid(SettingsErrorCode.INVALID_SEATS);
        }
        return new SettingsValidation.Valid(
                new GameSettings(names, input.initial(), input.smallBlind(), input.bigBlind(), input.button()));
    }
}
