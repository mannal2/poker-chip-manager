import { useLayoutEffect, type RefObject } from 'react';

type ViewportSize = { width: number; height: number };
let lastViewport: ViewportSize | undefined;
let editingViewport: ViewportSize | undefined;

// Shared by the screen and dialogs so they never write competing root dimensions.
function designViewport(width: number, height: number): ViewportSize {
  const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
  const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
  if (editingViewport && Math.abs(width - editingViewport.width) > 1)
    editingViewport = { width, height: layoutHeight };
  if (!editingViewport && editing) editingViewport = lastViewport ?? { width, height };
  if (editingViewport && height < editingViewport.height - 1 && layoutHeight > height + 1)
    return editingViewport;
  lastViewport = { width, height };
  editingViewport = editing ? lastViewport : undefined;
  return lastViewport;
}

// Use actual CSS dimensions, so pointer coordinates and card hit areas stay aligned.
export function useScreenFit(ref: RefObject<HTMLElement | null>, scrollable = false) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    let shifted: { node: HTMLElement; translate: string } | undefined;
    const resetShift = () => {
      if (shifted) shifted.node.style.translate = shifted.translate;
      shifted = undefined;
    };
    const fit = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const design = designViewport(width, height);
      const root = document.documentElement;
      if (root.style.getPropertyValue('--viewport-width') !== `${design.width}px`)
        root.style.setProperty('--viewport-width', `${design.width}px`);
      if (root.style.getPropertyValue('--viewport-height') !== `${design.height}px`)
        root.style.setProperty('--viewport-height', `${design.height}px`);
      if (root.style.getPropertyValue('--visual-height') !== `${height}px`)
        root.style.setProperty('--visual-height', `${height}px`);
      const body = getComputedStyle(document.body);
      const availableWidth =
        design.width - parseFloat(body.paddingLeft) - parseFloat(body.paddingRight);
      const availableHeight =
        design.height - parseFloat(body.paddingTop) - parseFloat(body.paddingBottom);
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
      resetShift();
      const input = document.activeElement;
      const dialog = input?.closest('dialog');
      const ownsInput =
        node.tagName === 'DIALOG' ? dialog === node : !dialog && node.contains(input);
      if (design.height > height + 1 && ownsInput && input instanceof HTMLElement) {
        let target = input.closest<HTMLElement>('.setup-fields,.seat') ?? input;
        if (target.getBoundingClientRect().height > height - 16) target = input;
        const bounds = target.getBoundingClientRect();
        const top = (viewport?.offsetTop ?? 0) + 8,
          bottom = top + height - 16;
        let shift = Math.min(0, bottom - bounds.bottom);
        if (bounds.top + shift < top) shift = top - bounds.top;
        if (Math.abs(shift) > 0.5) {
          shifted = { node: target, translate: target.style.translate };
          target.style.translate = `0 ${shift}px`;
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    observer.observe(document.documentElement);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    fit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      resetShift();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [ref, scrollable]);
}
