package xyz.jwlee.poker.game.model;

import java.util.ArrayList;
import java.util.List;

public final class Hand {
    public String id;
    public int number;
    public int street;
    public Phase phase;
    public int buttonSeat;
    public int sbSeat;
    public int bbSeat;
    /** TS {@code sb}. */
    public int smallBlind;
    /** TS {@code bb}. */
    public int bigBlind;
    /** Null when nobody is to act. */
    public String actorId;
    /** TS {@code W}: the bet to match this round. */
    public int currentBet;
    /** TS {@code R}: the minimum raise increment. */
    public int minRaise;
    public List<String> pending = new ArrayList<>();
    public boolean showdown;

    public Hand() {}

    public Hand copy() {
        Hand h = new Hand();
        h.id = id;
        h.number = number;
        h.street = street;
        h.phase = phase;
        h.buttonSeat = buttonSeat;
        h.sbSeat = sbSeat;
        h.bbSeat = bbSeat;
        h.smallBlind = smallBlind;
        h.bigBlind = bigBlind;
        h.actorId = actorId;
        h.currentBet = currentBet;
        h.minRaise = minRaise;
        h.pending = new ArrayList<>(pending);
        h.showdown = showdown;
        return h;
    }
}
