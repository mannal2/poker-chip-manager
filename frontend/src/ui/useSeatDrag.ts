import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { seatCoordinates } from './Table';
import { gapTarget, moveCircularSeat } from './seatOrder';
export function useSeatDrag(
  ids: string[],
  enabled: boolean,
  viewSeat: number,
  onCommit: (ids: string[]) => void,
  onTap?: (id: string) => void,
) {
  const [order, setOrder] = useState<string[] | null>(null),
    [position, setPosition] = useState<{ id: string; x: number; y: number } | null>(null);
  const session = useRef<{
    id: string;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
    active: boolean;
    order: string[];
    gap: number | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const key = ids.join('|');
  useEffect(
    () => () => {
      if (session.current) clearTimeout(session.current.timer);
      session.current = null;
      setOrder(null);
      setPosition(null);
    },
    [key, enabled, viewSeat],
  );
  function clear() {
    if (session.current) clearTimeout(session.current.timer);
    session.current = null;
    setOrder(null);
    setPosition(null);
  }
  function handlers(id: string) {
    return {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!enabled || e.button !== 0 || !e.isPrimary) return;
        suppressClick.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
        const s = {
          id,
          startX: e.clientX,
          startY: e.clientY,
          timer: setTimeout(() => {}, 0),
          active: false,
          order: ids,
          gap: null as number | null,
        };
        clearTimeout(s.timer);
        s.timer = setTimeout(() => {
          s.active = true;
          setOrder(ids);
        }, 350);
        session.current = s;
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const s = session.current;
        if (!s || s.id !== id) return;
        if (!s.active) {
          if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > 10) {
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
              clearTimeout(s.timer);
              s.active = true;
              setOrder(ids);
            } else {
              suppressClick.current = true;
              clear();
              return;
            }
          }
          if (!s.active) return;
        }
        const r = e.currentTarget.parentElement!.getBoundingClientRect(),
          x = e.clientX - r.x,
          y = e.clientY - r.y;
        setPosition({ id, x, y });
        const points = seatCoordinates[ids.length].map(([px, py]) => [
          (px / 100) * r.width,
          (py / 100) * r.height,
        ]);
        const gaps = points.map(([ax, ay], i) => {
          const [bx, by] = points[(i + 1) % points.length];
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2),
            ),
          );
          return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
        });
        let gap = gaps.indexOf(Math.min(...gaps));
        // Keep the current gap near a shared boundary instead of flickering.
        if (s.gap !== null && gaps[s.gap] <= gaps[gap] + 8) gap = s.gap;
        s.gap = gap;
        const from = s.order.indexOf(id),
          n = ids.length;
        let target = gapTarget(from, (gap + viewSeat) % n, n);
        // A drop on a card centre still means occupying that seat.
        const distances = points.map(([px, py]) => Math.hypot(x - px, y - py));
        const nearest = distances.indexOf(Math.min(...distances));
        if (distances[nearest] < 18) target = (nearest + viewSeat) % n;
        const next = moveCircularSeat(s.order, id, target);
        s.order = next;
        setOrder(next);
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const s = session.current,
          r = e.currentTarget.parentElement!.getBoundingClientRect();
        if (s?.active) suppressClick.current = true;
        if (
          s?.active &&
          e.clientX >= r.x &&
          e.clientX <= r.right &&
          e.clientY >= r.y &&
          e.clientY <= r.bottom &&
          s.order.join('|') !== ids.join('|')
        )
          onCommit(s.order);
        clear();
      },
      onClick: () => {
        if (!enabled || suppressClick.current) return;
        onTap?.(id);
      },
      onPointerCancel: () => {
        suppressClick.current = true;
        clear();
      },
      onLostPointerCapture: clear,
    };
  }
  return { order: order ?? ids, position, handlers };
}
