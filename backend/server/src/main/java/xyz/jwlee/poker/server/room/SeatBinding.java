package xyz.jwlee.poker.server.room;

// 세션이 들고 있는 자리 자격(참가자 ID와 그 자리의 자격 값)
/** What a session holds for one seat. Only {@link Room#seatOf} says whether it still opens that seat. */
public record SeatBinding(String participantId, String credential) { }
