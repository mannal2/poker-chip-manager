import { useLayoutEffect, type RefObject } from 'react';

// Use actual CSS dimensions, so pointer coordinates and card hit areas stay aligned.
export function useScreenFit(ref: RefObject<HTMLElement | null>, scrollable = false) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const fit = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const root = document.documentElement;
      if (root.style.getPropertyValue('--viewport-width') !== `${width}px`)
        root.style.setProperty('--viewport-width', `${width}px`);
      if (root.style.getPropertyValue('--viewport-height') !== `${height}px`)
        root.style.setProperty('--viewport-height', `${height}px`);
      const body = getComputedStyle(document.body);
      const availableWidth = width - parseFloat(body.paddingLeft) - parseFloat(body.paddingRight);
      const availableHeight = height - parseFloat(body.paddingTop) - parseFloat(body.paddingBottom);
      const base = Math.min(Math.max(1, availableWidth / 390), availableHeight / 560);
      const current = parseFloat(getComputedStyle(node).fontSize) / 15;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || !current) return;
      const unit = scrollable
        ? base
        : Math.min(
            base,
            availableWidth / (rect.width / current),
            availableHeight / (Math.max(node.scrollHeight, rect.height) / current),
          );
      const value = Math.max(0.01, unit);
      const previous = parseFloat(node.style.getPropertyValue('--u'));
      // CSSOM rounds lengths; ignore subpixel noise so ResizeObserver can settle.
      if (!Number.isFinite(previous) || Math.abs(previous - value) > 0.0001)
        node.style.setProperty('--u', `${value}px`);
      if (node.tagName === 'DIALOG') {
        const left = `${(viewport?.offsetLeft ?? 0) + width / 2}px`;
        const top = `${(viewport?.offsetTop ?? 0) + height / 2}px`;
        if (node.style.left !== left) node.style.left = left;
        if (node.style.top !== top) node.style.top = top;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  });
}
