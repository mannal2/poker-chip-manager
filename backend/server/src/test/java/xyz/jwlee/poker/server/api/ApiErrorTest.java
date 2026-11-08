package xyz.jwlee.poker.server.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

// 복구·접속 오류 코드에 화면용 한국어 메시지가 있는지 검사한다
class ApiErrorTest {

    // 복구·연결 오류 코드마다 한국어 메시지가 있는지 확인한다
    @Test
    void recoveryAndConnectionCodesHaveAKoreanMessage() {
        for (String code : new String[] {"RECOVERY_TARGET_NOT_FOUND", "RECOVERY_LIMIT", "ALREADY_PARTICIPANT",
                "NOT_CONNECTED", "NOT_ELIMINATED", "RECOVERY_NOT_PENDING"}) {
            assertThat(ApiError.of(code).message()).as(code).containsPattern("[가-힣]");
        }
    }
}
