package xyz.jwlee.poker.game.rule;

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
