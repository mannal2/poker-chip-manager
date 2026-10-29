package xyz.jwlee.poker.game.model;

import java.util.List;

/**
 * State to restore on undo, with its own {@code undo} always null. {@code eventIds} is null when
 * the snapshot carries none.
 */
public record UndoSnapshot(GameState state, List<String> eventIds) {
    public UndoSnapshot copy() {
        return new UndoSnapshot(state.copy(), eventIds == null ? null : List.copyOf(eventIds));
    }
}
