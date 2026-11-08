package xyz.jwlee.poker.server.room;

// 서버가 거절한 요청을 나타내는 예외로, 오류 코드를 담는다
/**
 * A request the server refuses; {@link #code()} is the wire error code, the API layer picks the HTTP status.
 * Server codes come from {@link ErrorCode}; a rules-module rejection keeps its own enum name ({@link #rule}); a
 * rejection read back from a request ledger keeps the code it was recorded with ({@link #replayed}).
 */
public final class RoomException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String code;

    public RoomException(ErrorCode code) {
        this(code.name());
    }

    private RoomException(String code) {
        super(code, null, false, false);
        this.code = code;
    }

    // 규칙 모듈의 거절 코드를 이름 그대로 담는다
    public static RoomException rule(Enum<?> code) {
        return new RoomException(code.name());
    }

    // 원장에 기록된 거절 코드를 다시 던질 때 쓴다
    public static RoomException replayed(String code) {
        return new RoomException(code);
    }

    public String code() {
        return code;
    }
}
