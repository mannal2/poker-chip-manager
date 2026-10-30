/** Storage failures on this device, newest first; kept outside IndexedDB so they survive it failing. */
export interface StorageErrorEntry {
  at: string;
  phase: string;
  name: string;
  message: string;
  /** Page visibility and installed-app mode when it failed, to tell resume and PWA cases apart. */
  visibility: string;
  standalone: boolean;
}

const key = 'poker-local:storage-errors';
const limit = 10;

export function readStorageErrors(): StorageErrorEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function recordStorageError(phase: string, error: unknown) {
  const entry: StorageErrorEntry = {
    at: new Date().toISOString(),
    phase,
    name: error instanceof Error || error instanceof DOMException ? error.name : typeof error,
    message:
      error instanceof Error || error instanceof DOMException ? error.message : String(error),
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
    standalone:
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  };
  try {
    localStorage.setItem(key, JSON.stringify([entry, ...readStorageErrors()].slice(0, limit)));
  } catch {
    // Diagnostics must never turn a storage failure into a second failure.
  }
}
