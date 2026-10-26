import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { seatCoordinates } from './seatLayout';
import { gapTarget, moveCircularSeat } from './seatOrder';
export function useSeatDrag(
  ids: string[],
  enabled: boolean,
  viewSeat: number,
  onCommit: (ids: string[]) => void,
  onTap?: (id: string) => void,
  prepare?: () => Promise<boolean>,
) {
  const [order, setOrder] = useState<string[] | null>(null),
    [position, setPosition] = useState<{ id: string; x: number; y: number } | null>(null),
    [pressed, setPressed] = useState<string | null>(null),
    [ready, setReady] = useState<string | null>(null);
  const session = useRef<{
    id: string;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
    active: boolean;
    waiting: boolean;
    order: string[];
    gap: number | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const key = ids.join('|');
  const clear = useCallback(() => {
    if (session.current) clearTimeout(session.current.timer);
    session.current = null;
    setOrder(null);
    setPosition(null);
    setPressed(null);
    setReady(null);
  }, []);
  useEffect(() => {
    const cancel = () => {
      if (!session.current) return;
      suppressClick.current = true;
      clear();
    };
    const additionalPointer = (event: globalThis.PointerEvent) => {
      if (!event.isPrimary) cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('pointerdown', additionalPointer, true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerdown', additionalPointer, true);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', cancel);
      clear();
    };
  }, [key, viewSeat, clear]);
  function handlers(id: string) {
    return {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if ((!enabled && !prepare) || e.button !== 0 || !e.isPrimary) return;
        suppressClick.current = false;
        setPressed(id);
        e.currentTarget.setPointerCapture(e.pointerId);
        const s = {
          id,
          startX: e.clientX,
          startY: e.clientY,
          timer: setTimeout(() => {}, 0),
          active: false,
          waiting: !!prepare,
          order: ids,
          gap: null as number | null,
        };
        clearTimeout(s.timer);
        session.current = s;
        const started = performance.now();
        const begin = (allowed: boolean) => {
          if (session.current !== s) return;
          if (!allowed) {
            suppressClick.current = true;
            clear();
            return;
          }
          s.waiting = false;
          s.timer = setTimeout(
            () => {
              s.active = true;
              setReady(id);
              setOrder(ids);
            },
            Math.max(0, 350 - (performance.now() - started)),
          );
        };
        if (prepare) void prepare().then(begin, () => begin(false));
        else begin(true);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const s = session.current;
        if (!s || s.id !== id || s.waiting || !enabled) return;
        if (!s.active) {
          if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > 10) {
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
              clearTimeout(s.timer);
              s.active = true;
              setReady(id);
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
        if (s?.active || s?.waiting) suppressClick.current = true;
        if (
          enabled &&
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
  return { order: order ?? ids, position, pressed, ready, handlers };
}
