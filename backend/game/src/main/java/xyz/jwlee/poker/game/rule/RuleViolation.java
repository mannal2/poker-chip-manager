package xyz.jwlee.poker.game.rule;

// 규칙 위반을 알리는 예외로, 오류 코드를 담는다
/** Thrown inside command handlers; the transition turns it into a rejection. */
public final class RuleViolation extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final RuleErrorCode code;

    public RuleViolation(RuleErrorCode code) {
        super(code.name());
        this.code = code;
    }

    public RuleErrorCode code() {
        return code;
    }
}
