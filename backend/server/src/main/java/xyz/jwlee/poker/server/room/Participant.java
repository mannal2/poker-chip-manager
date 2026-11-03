package xyz.jwlee.poker.server.room;

// 방에 있는 사람 한 명(이름, 입장 순서, 조작권 세대, 자리 자격)
/**
 * A person in a room. Elimination or forfeit lives in the game state, not here. {@code credential} is what a
 * session must hold to use this seat; it never leaves the server except in that session's own binding.
 */
public record Participant(String participantId, String name, int joinOrder, long controlGeneration,
        String credential) { }
