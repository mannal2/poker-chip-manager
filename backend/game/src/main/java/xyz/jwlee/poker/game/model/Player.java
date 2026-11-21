package xyz.jwlee.poker.game.model;

// 플레이어 한 명의 스택과 베팅 상태
public final class Player {
    public String id;
    public String name;
    public int stack;
    public boolean eliminated;
    public boolean folded;
    /** Server-only: the player forfeited; the stack is split among survivors when the hand ends. */
    public boolean forfeited;
    /** TS {@code B}: chips put in during the current betting round. */
    public int roundBet;
    /** TS {@code H}: chips put in during the whole hand. */
    public int handTotal;
    /** TS {@code actedAt}: the current bet when this player last acted, or null. */
    public Integer actedAtBet;
    /** TS {@code reopenAt}. */
    public int reopensAt;
    /** Entry number of a bought-in player (1 for a new name, higher for a re-entry); null for the original players. */
    public Integer entry;
    /** Null once the player is dealt in. */
    public Joining joining;
    /** The eliminated player whose seat this buy-in took; dropped when dealt in. */
    public Player replaced;

    public Player() {}

    // 플레이어의 복사본을 만든다
    public Player copy() {
        Player p = new Player();
        p.id = id;
        p.name = name;
        p.stack = stack;
        p.eliminated = eliminated;
        p.folded = folded;
        p.forfeited = forfeited;
        p.roundBet = roundBet;
        p.handTotal = handTotal;
        p.actedAtBet = actedAtBet;
        p.reopensAt = reopensAt;
        p.entry = entry;
        p.joining = joining;
        p.replaced = replaced == null ? null : replaced.copy();
        return p;
    }
}
