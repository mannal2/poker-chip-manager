package xyz.jwlee.poker.game.settings;

import xyz.jwlee.poker.game.model.GameSettings;

// 설정 검증 결과로, 유효 또는 무효 중 하나다
public sealed interface SettingsValidation {
    // 검증을 통과한 정규화된 설정
    /** Settings with trimmed, NFC-normalized names. */
    record Valid(GameSettings settings) implements SettingsValidation {}

    // 검증에 실패한 사유
    record Invalid(SettingsErrorCode code) implements SettingsValidation {}
}
