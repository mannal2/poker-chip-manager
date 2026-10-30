package xyz.jwlee.poker.game.rule;

public final class Rules {
    private Rules() {}

    public static void require(boolean ok) {
        require(ok, RuleErrorCode.INVALID_ACTION);
    }

    public static void require(boolean ok, RuleErrorCode code) {
        if (!ok) {
            throw new RuleViolation(code);
        }
    }
}
