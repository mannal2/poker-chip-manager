package xyz.jwlee.poker.game;

import xyz.jwlee.poker.game.model.Player;

/** What the current actor may do; {@code actor} is null when nobody can act. */
public record LegalActions(
        Player actor,
        int callAdditional,
        int minRaiseAdditional,
        int maxAdditional,
        boolean canRaise,
        boolean canCheck,
        boolean canCall,
        LegalReasonCode reasonCode) {}
