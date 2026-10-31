package xyz.jwlee.poker.server.room;

// 파이프라인이 돌려주는 처리 결과와 대상 방
/** What the pipeline answers: the recorded (or replayed) outcome and the room it ran against. */
public record CommandResult(RequestOutcome outcome, Room room) { }
