package xyz.jwlee.poker.game;

import xyz.jwlee.poker.game.model.BlindSeats;
import xyz.jwlee.poker.game.model.SeatPositions;

public final class Positions {
    private Positions() {}

    /** First eligible seat after {@code from}, wrapping around (possibly {@code from} itself). */
    public static int nextSeat(int from, boolean[] eligible) {
        for (int k = 1; k <= eligible.length; k++) {
            int i = (from + k) % eligible.length;
            if (eligible[i]) {
                return i;
            }
        }
        throw new IllegalStateException("NO_ELIGIBLE_SEAT");
    }

    public static SeatPositions nextPositions(boolean[] alive, SeatPositions previous) {
        int bbSeat = nextSeat(previous.bbSeat(), alive);
        if (aliveCount(alive) == 2) {
            int buttonSeat = nextSeat(bbSeat, alive);
            return new SeatPositions(buttonSeat, buttonSeat, bbSeat);
        }
        int sbSeat = previous.bbSeat();
        int buttonSeat = previous.sbSeat();
        while (!alive[buttonSeat]) {
            int next = (buttonSeat + 1) % alive.length;
            if (next == sbSeat || alive[next]) {
                break;
            }
            buttonSeat = next;
        }
        return new SeatPositions(buttonSeat, sbSeat, bbSeat);
    }

    /** Blind seats for the first hand from a chosen button; heads-up the button posts the SB. */
    public static BlindSeats initialBlindSeats(int button, boolean[] alive) {
        int sbSeat = aliveCount(alive) == 2 ? button : nextSeat(button, alive);
        return new BlindSeats(sbSeat, nextSeat(sbSeat, alive));
    }

    private static int aliveCount(boolean[] alive) {
        int n = 0;
        for (boolean a : alive) {
            if (a) {
                n++;
            }
        }
        return n;
    }
}
