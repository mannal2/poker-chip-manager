package xyz.jwlee.poker.game.settings;

import xyz.jwlee.poker.game.model.GameSettings;

public sealed interface SettingsValidation {
    /** Settings with trimmed, NFC-normalized names. */
    record Valid(GameSettings settings) implements SettingsValidation {}

    record Invalid(SettingsErrorCode code) implements SettingsValidation {}
}
