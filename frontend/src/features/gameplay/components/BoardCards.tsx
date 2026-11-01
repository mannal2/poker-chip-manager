import { useLayoutEffect, useRef } from 'react';
import type { GameSession } from '../session';

// 스트리트에 맞는 수의 공용 카드 자리를 그리고 새 카드에 등장 효과를 준다
export function BoardCards({
  phase,
  street,
  handKey,
  boardReveal,
}: {
  phase: string;
  street: string;
  handKey?: string;
  boardReveal?: GameSession['boardReveal'];
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const previousBoard = useRef<{ hand?: string; count: number; version?: number } | null>(null);
  const animations = useRef<Animation[]>([]);
  const version = boardReveal?.version;
  const from = boardReveal?.from;
  const count =
    phase === 'setup'
      ? 0
      : phase === 'settlement'
        ? 5
        : ({ PREFLOP: 0, FLOP: 3, TURN: 4, RIVER: 5 }[street] ?? 0);
  // 카드 구성이 바뀌거나 화면이 닫힐 때에만 이전 보드의 효과를 정리한다.
  useLayoutEffect(
    () => () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    },
    [count, handKey],
  );
  useLayoutEffect(() => {
    const previous = previousBoard.current;
    previousBoard.current = { hand: handKey, count, version };
    if (
      !previous ||
      (from !== undefined && from !== previous.version) ||
      previous.hand !== handKey ||
      count <= previous.count ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const cards = [...(boardRef.current?.querySelectorAll('.board-card') ?? [])];
    animations.current = cards.slice(previous.count).map((card) =>
      card.animate(
        [
          { opacity: 0.4, transform: 'scale(0.92)' },
          { opacity: 1, transform: 'scale(1.08)', borderColor: '#e2bd75', offset: 0.4 },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: 520, easing: 'ease-out' },
      ),
    );
  }, [count, handKey, from, version]);
  return (
    <div
      ref={boardRef}
      className="board"
      role="img"
      data-street={street}
      aria-label={`${phase === 'settlement' ? '쇼다운' : ({ PREFLOP: '프리플랍', FLOP: '플랍', TURN: '턴', RIVER: '리버' }[street] ?? street)} 보드 ${count}장`}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`board-card ${phase !== 'settlement' && (count === 3 || i === count - 1) ? 'current' : ''}`}
        />
      ))}
    </div>
  );
}
