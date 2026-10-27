import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installZoomPolicy } from '../shared/browser/zoomPolicy';

/** Shared start-up for every HTML entry: zoom policy, then the page's React root. */
export function mount(page: ReactNode) {
  installZoomPolicy();
  createRoot(document.getElementById('root')!).render(page);
}
