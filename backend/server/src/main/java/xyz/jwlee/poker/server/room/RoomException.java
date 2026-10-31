package xyz.jwlee.poker.server.room;

// 서버가 거절한 요청을 나타내는 예외로, 오류 코드를 담는다
/** A request the server refuses; {@link #code()} is the wire error code, the API layer picks the HTTP status. */
public final class RoomException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String code;

    public RoomException(String code) {
        super(code, null, false, false);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
