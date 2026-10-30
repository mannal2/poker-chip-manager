package xyz.jwlee.poker.server.room;

/** A person in a room. Elimination or forfeit lives in the game state, not here. */
public record Participant(String participantId, String name, int joinOrder, long controlGeneration) { }
