package xyz.jwlee.poker.game.model;

import java.util.ArrayList;
import java.util.List;

// 토너먼트 전체 상태(플레이어, 핸드, 팟, 되돌리기 스냅샷)
public final class GameState {
    public String tournamentId;
    public int version;
    public TournamentStatus status;
    public GameSettings settings;
    public int initialTotal;
    /** Null when the state carries no setup order. */
    public List<String> setupOrder;
    public List<Player> players = new ArrayList<>();
    /** Null between hands. */
    public Hand hand;
    public int pot;
    public Blinds pendingBlinds;
    public UndoSnapshot undo;

    public GameState() {}

    // 중첩 객체까지 모두 복제한 깊은 복사본을 만든다
    /** Deep copy: nested lists, players, hand and the undo snapshot are all duplicated. */
    public GameState copy() {
        GameState s = new GameState();
        s.tournamentId = tournamentId;
        s.version = version;
        s.status = status;
        s.settings = settings; // immutable record
        s.initialTotal = initialTotal;
        s.setupOrder = setupOrder == null ? null : new ArrayList<>(setupOrder);
        s.players = new ArrayList<>(players.size());
        for (Player p : players) {
            s.players.add(p.copy());
        }
        s.hand = hand == null ? null : hand.copy();
        s.pot = pot;
        s.pendingBlinds = pendingBlinds; // immutable record
        s.undo = undo == null ? null : undo.copy();
        return s;
    }
}
