package xyz.jwlee.poker.game.model;

import java.util.List;

/** Table setup. {@code smallBlind}/{@code bigBlind} are the TS {@code sb}/{@code bb}. */
public record GameSettings(List<String> names, int initial, int smallBlind, int bigBlind, int button) {
    public GameSettings {
        names = List.copyOf(names);
    }
}
