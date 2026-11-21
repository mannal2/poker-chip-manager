package xyz.jwlee.poker.game.model;

// 바이인한 사람이 카드를 받기 전 기다리는 방식(다음 핸드 또는 버튼이 지나간 뒤)
/** TS {@code joining}: {@code 'next-hand'} or {@code 'button'}. */
public enum Joining {
    NEXT_HAND,
    BUTTON
}
