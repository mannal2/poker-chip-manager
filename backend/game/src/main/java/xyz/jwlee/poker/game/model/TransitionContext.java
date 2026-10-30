package xyz.jwlee.poker.game.model;

/** Identity and timestamp the caller supplies for one transition (event ids derive from it). */
public record TransitionContext(String id, String at) {}
