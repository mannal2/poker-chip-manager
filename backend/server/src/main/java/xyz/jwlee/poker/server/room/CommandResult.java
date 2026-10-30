package xyz.jwlee.poker.server.room;

/** What the pipeline answers: the recorded (or replayed) outcome and the room it ran against. */
public record CommandResult(RequestOutcome outcome, Room room) { }
