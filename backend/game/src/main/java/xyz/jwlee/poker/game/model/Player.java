package xyz.jwlee.poker.game.model;

public final class Player {
    public String id;
    public String name;
    public int stack;
    public boolean eliminated;
    public boolean folded;
    /** TS {@code B}: chips put in during the current betting round. */
    public int roundBet;
    /** TS {@code H}: chips put in during the whole hand. */
    public int handTotal;
    /** TS {@code actedAt}: the current bet when this player last acted, or null. */
    public Integer actedAtBet;
    /** TS {@code reopenAt}. */
    public int reopensAt;

    public Player() {}

    public Player copy() {
        Player p = new Player();
        p.id = id;
        p.name = name;
        p.stack = stack;
        p.eliminated = eliminated;
        p.folded = folded;
        p.roundBet = roundBet;
        p.handTotal = handTotal;
        p.actedAtBet = actedAtBet;
        p.reopensAt = reopensAt;
        return p;
    }
}
