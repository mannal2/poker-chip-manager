package xyz.jwlee.poker.server.room;

// 대기실에서 정하는 테이블 설정
/** Table setup shown in the waiting room; {@code button} is -1 until a seat is chosen. */
public record RoomSettings(int initial, int sb, int bb, int button) {

    // 기본 설정(시작 칩 1000, 블라인드 10/20, 딜러 미정)을 돌려준다
    public static RoomSettings defaults() {
        return new RoomSettings(1000, 10, 20, -1);
    }
}
