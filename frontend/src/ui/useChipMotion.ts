import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ChipTransfer } from './chipTransfer';
type Point = { x: number; y: number };
type Prepared = {
  epoch: number;
  moves: ChipTransfer[];
  points: Map<string, Point>;
  size: number;
};
export function useChipMotion(screen: RefObject<HTMLElement | null>, scope: string) {
  const epoch = useRef(0);
  const active = useRef(new Set<HTMLElement>());
  const clear = useCallback(() => {
    epoch.current++;
    for (const node of active.current) {
      node.getAnimations().forEach((a) => a.cancel());
      node.remove();
    }
    active.current.clear();
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('resize', clear);
    window.visualViewport?.addEventListener('resize', clear);
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hidden);
    media.addEventListener('change', clear);
    return () => {
      clear();
      window.removeEventListener('resize', clear);
      window.visualViewport?.removeEventListener('resize', clear);
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hidden);
      media.removeEventListener('change', clear);
    };
  }, [clear, scope]);
  const prepare = useCallback(
    (moves: ChipTransfer[]): Prepared | null => {
      if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        return null;
      if (!moves.length) return null;
      const points = new Map<string, Point>();
      const point = (id: string, element: Element | null | undefined) => {
        const r = element?.getBoundingClientRect();
        if (r?.width && r.height) points.set(id, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
      };
      point('pot', screen.current?.querySelector('.pot strong'));
      screen.current
        ?.querySelectorAll<HTMLElement>('.seat')
        .forEach((seat) => point(seat.dataset.player!, seat.querySelector('.card-values')));
      const unit = parseFloat(getComputedStyle(screen.current!).fontSize) / 15;
      return { epoch: epoch.current, moves, points, size: 12 * unit };
    },
    [screen],
  );
  const play = useCallback((prepared: Prepared | null) => {
    if (
      !prepared ||
      prepared.epoch !== epoch.current ||
      document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    for (const move of prepared.moves) {
      const from = prepared.points.get(move.from),
        to = prepared.points.get(move.to);
      if (!from || !to) continue;
      const node = document.createElement('span');
      node.className = 'chip-flight';
      node.setAttribute('aria-hidden', 'true');
      Object.assign(node.dataset, {
        from: move.from,
        to: move.to,
        amount: String(move.amount),
        kind: move.kind,
      });
      Object.assign(node.style, {
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${prepared.size}px`,
        height: `${prepared.size}px`,
      });
      for (let n = 0; n < 3; n++) node.appendChild(document.createElement('i'));
      document.body.appendChild(node);
      active.current.add(node);
      const x = to.x - from.x,
        y = to.y - from.y;
      const animation = node.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 0 },
          {
            transform: `translate(calc(-50% + ${x * 0.45}px), calc(-50% + ${y * 0.45 - Math.min(24, Math.hypot(x, y) * 0.12)}px)) scale(1)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0.65)`,
            opacity: 0,
          },
        ],
        { duration: 720, delay: move.delay, easing: 'ease-in-out', fill: 'both' },
      );
      animation.onfinish = () => {
        node.remove();
        active.current.delete(node);
      };
    }
  }, []);
  return { prepare, play, clear };
}
