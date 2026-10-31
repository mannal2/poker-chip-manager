package xyz.jwlee.poker.server.room;

// 방에 있는 사람 한 명(이름, 입장 순서, 조작권 세대)
/** A person in a room. Elimination or forfeit lives in the game state, not here. */
public record Participant(String participantId, String name, int joinOrder, long controlGeneration) { }
