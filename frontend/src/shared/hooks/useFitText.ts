import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shrinks the font of each matching cell until its text fits, starting from the container's
 * size variable. A cell that still overflows at the minimum and has a `data-short` attribute
 * gets the `fit-short` class, whose CSS shows that shorter text instead, and is fitted again.
 * Re-runs after every render and whenever the container resizes.
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
    const shrink = (cell: HTMLElement) => {
      let size = Number(getComputedStyle(container).getPropertyValue(sizeVar));
      cell.style.fontSize = `calc(${size} * ${unit})`;
      while (cell.scrollWidth > cell.clientWidth && size > min) {
        size -= step;
        cell.style.fontSize = `calc(${size} * ${unit})`;
      }
      return cell.scrollWidth <= cell.clientWidth;
    };
    const fit = () =>
      container.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
        cell.classList.remove('fit-short');
        if (shrink(cell) || !cell.dataset.short) return;
        cell.classList.add('fit-short');
        shrink(cell);
      });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  });
}
