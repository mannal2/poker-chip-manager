package xyz.jwlee.poker.game.command;

// 바이인한 사람이 앉을 자리(어느 사람 뒤 또는 탈락자 자리)
public sealed interface BuyInPlacement {
    // 지정한 플레이어 바로 뒤에 새 자리를 만든다
    record Between(String after) implements BuyInPlacement {}

    // 탈락한 플레이어의 자리를 차지한다
    record Replace(String playerId) implements BuyInPlacement {}
}
