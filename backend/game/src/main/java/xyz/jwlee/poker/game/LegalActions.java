package xyz.jwlee.poker.game;

import xyz.jwlee.poker.game.model.Player;

// 현재 차례 플레이어가 선택할 수 있는 행동과 금액 한도를 담는다
/**
 * What the current actor may do; {@code actor} is null when nobody can act. {@code actor} is the
 * state's own mutable player object (see {@link Legal#of}); callers outside handlers must not mutate it.
 */
public record LegalActions(
        Player actor,
        int callAdditional,
        int minRaiseAdditional,
        int maxAdditional,
        boolean canRaise,
        boolean canCheck,
        boolean canCall,
        LegalReasonCode reasonCode) {}
