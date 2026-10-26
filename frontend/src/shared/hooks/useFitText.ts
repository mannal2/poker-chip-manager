import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shrinks the font of each matching cell until its text fits, starting from the container's
 * size variable. Re-runs after every render and whenever the container resizes.
 */
export function useFitText(
  ref: RefObject<HTMLElement | null>,
  {
    selector,
    sizeVar,
    unit,
    min,
    step = 0.25,
  }: { selector: string; sizeVar: string; unit: string; min: number; step?: number },
) {
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const fit = () =>
      container.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
        let size = Number(getComputedStyle(container).getPropertyValue(sizeVar));
        cell.style.fontSize = `calc(${size} * ${unit})`;
        while (cell.scrollWidth > cell.clientWidth && size > min) {
          size -= step;
          cell.style.fontSize = `calc(${size} * ${unit})`;
        }
      });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  });
}
