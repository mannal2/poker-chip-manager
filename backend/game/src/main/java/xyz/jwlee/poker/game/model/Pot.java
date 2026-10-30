package xyz.jwlee.poker.game.model;

import java.util.List;

/** One pot and the ids of the players who may win it, in seat order. */
public record Pot(String id, int amount, List<String> eligible) {}
