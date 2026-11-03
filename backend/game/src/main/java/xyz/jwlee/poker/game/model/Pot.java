package xyz.jwlee.poker.game.model;

import java.util.List;

// 팟 하나의 금액과 수령 자격이 있는 플레이어
/** One pot and the ids of the players who may win it, in seat order. */
public record Pot(String id, int amount, List<String> eligible) {}
