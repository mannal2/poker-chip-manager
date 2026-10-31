package xyz.jwlee.poker.game;

import xyz.jwlee.poker.game.model.BlindSeats;
import xyz.jwlee.poker.game.model.SeatPositions;

// 버튼/스몰블라인드/빅블라인드 좌석 계산을 담당한다
public final class Positions {
    private Positions() {}

    // 기준 좌석의 다음 자리부터 순환하며 참가 자격이 있는 첫 좌석을 찾는다
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

    // 이전 핸드 기준으로 다음 핸드의 버튼과 블라인드 좌석을 정한다
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

    // 첫 핸드의 스몰/빅블라인드 좌석을 버튼에서 계산한다
    /** Blind seats for the first hand from a chosen button; heads-up the button posts the SB. */
    public static BlindSeats initialBlindSeats(int button, boolean[] alive) {
        int sbSeat = aliveCount(alive) == 2 ? button : nextSeat(button, alive);
        return new BlindSeats(sbSeat, nextSeat(sbSeat, alive));
    }

    // 생존 좌석 수를 센다
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
