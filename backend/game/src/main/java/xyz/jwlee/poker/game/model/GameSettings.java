package xyz.jwlee.poker.game.model;

import java.util.List;

// 테이블 설정(이름, 시작 칩, 블라인드, 버튼 좌석)
/** Table setup. {@code smallBlind}/{@code bigBlind} are the TS {@code sb}/{@code bb}. */
public record GameSettings(List<String> names, int initial, int smallBlind, int bigBlind, int button) {
    // 이름 목록을 불변 복사본으로 고정한다
    public GameSettings {
        names = List.copyOf(names);
    }
}
