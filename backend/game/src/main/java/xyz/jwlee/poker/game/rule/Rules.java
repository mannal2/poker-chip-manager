package xyz.jwlee.poker.game.rule;

// 규칙 조건을 검사하는 도우미
public final class Rules {
    private Rules() {}

    // 조건이 거짓이면 기본 코드(INVALID_ACTION)로 규칙 위반을 던진다
    public static void require(boolean ok) {
        require(ok, RuleErrorCode.INVALID_ACTION);
    }

    // 조건이 거짓이면 지정한 코드로 규칙 위반을 던진다
    public static void require(boolean ok, RuleErrorCode code) {
        if (!ok) {
            throw new RuleViolation(code);
        }
    }
}
