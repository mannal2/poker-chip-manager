import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { payoutGains, type ChipTransfer } from '../model/chipTransfer';
// 화면 좌표 한 점
type Point = { x: number; y: number };
// 애니메이션 시작 전에 측정해 둔 이동 목록과 좌표
type Prepared = {
  epoch: number;
  moves: ChipTransfer[];
  points: Map<string, Point>;
  size: number;
  unit: number;
  /** Top centre of each seat card, where a payout label rises from. */
  tops: Map<string, Point>;
};
// 지금 칩 애니메이션을 재생해도 되는지 확인한다
/** Chip flights are skipped while the page is hidden or the user prefers reduced motion. */
export function canAnimate() {
  return !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// 칩 이동 애니메이션을 준비/재생/정리하는 훅
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
      if (!canAnimate() || !moves.length) return null;
      const points = new Map<string, Point>();
      const point = (id: string, element: Element | null | undefined) => {
        const r = element?.getBoundingClientRect();
        if (r?.width && r.height) points.set(id, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
      };
      point('pot', screen.current?.querySelector('.pot strong'));
      const tops = new Map<string, Point>();
      screen.current?.querySelectorAll<HTMLElement>('.seat').forEach((seat) => {
        point(seat.dataset.player!, seat.querySelector('.card-values'));
        const r = seat.getBoundingClientRect();
        if (r.width && r.height) tops.set(seat.dataset.player!, { x: r.x + r.width / 2, y: r.y });
      });
      const unit = parseFloat(getComputedStyle(screen.current!).fontSize) / 15;
      return { epoch: epoch.current, moves, points, size: 12 * unit, unit, tops };
    },
    [screen],
  );
  const play = useCallback((prepared: Prepared | null) => {
    if (!prepared || prepared.epoch !== epoch.current || !canAnimate()) return;
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
    // 지급 칩이 도착할 때 수령자 카드 위에 받은 금액을 잠깐 띄운다
    for (const gain of payoutGains(prepared.moves)) {
      // 카드 안 숫자를 가리지 않도록 카드 위쪽 바깥에서 떠오른다
      const at = prepared.tops.get(gain.to);
      if (!at) continue;
      const label = document.createElement('span');
      label.className = 'payout-gain';
      label.setAttribute('aria-hidden', 'true');
      label.dataset.to = gain.to;
      label.textContent = `+${gain.amount.toLocaleString('ko-KR')}`;
      Object.assign(label.style, { left: `${at.x}px`, top: `${at.y}px` });
      document.body.appendChild(label);
      active.current.add(label);
      const animation = label.animate(
        [
          // 카드 윗변의 D·SB·BB 배지를 피하도록 8만큼 띄워서 시작한다
          { transform: `translate(-50%, calc(-100% - ${8 * prepared.unit}px))`, opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { opacity: 1, offset: 0.6 },
          { transform: `translate(-50%, calc(-100% - ${24 * prepared.unit}px))`, opacity: 0 },
        ],
        { duration: 1200, delay: gain.delay + 600, easing: 'ease-out', fill: 'both' },
      );
      animation.onfinish = () => {
        label.remove();
        active.current.delete(label);
      };
    }
  }, []);
  return { prepare, play, clear };
}
