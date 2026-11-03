package xyz.jwlee.poker.game.model;

// 한 번의 전이에 쓰이는 식별자와 시각
/** Identity and timestamp the caller supplies for one transition (event ids derive from it). */
public record TransitionContext(String id, String at) {}
