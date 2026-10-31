package xyz.jwlee.poker.game.model;

import java.util.List;

// 되돌리기용으로 저장한 상태와 해당 이벤트 id
/**
 * State to restore on undo, with its own {@code undo} always null. {@code eventIds} is null when
 * the snapshot carries none.
 */
public record UndoSnapshot(GameState state, List<String> eventIds) {
    // 스냅샷의 깊은 복사본을 만든다
    public UndoSnapshot copy() {
        return new UndoSnapshot(state.copy(), eventIds == null ? null : List.copyOf(eventIds));
    }
}
