package xyz.jwlee.poker.server.room;

/** Table setup shown in the waiting room; {@code button} is -1 until a seat is chosen. */
public record RoomSettings(int initial, int sb, int bb, int button) {

    public static RoomSettings defaults() {
        return new RoomSettings(1000, 10, 20, -1);
    }
}
