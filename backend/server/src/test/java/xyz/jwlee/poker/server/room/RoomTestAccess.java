package xyz.jwlee.poker.server.room;

// 다른 패키지의 테스트가 패키지 전용 방 조작을 쓰게 해 주는 통로
public final class RoomTestAccess {

    private RoomTestAccess() {}

    // 방을 닫는다. 호출자는 방 잠금 안에 있어야 한다
    public static void close(Room room) {
        room.close();
    }
}
