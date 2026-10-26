// An update check can resolve before the new worker finishes caching its files.
export function checkForUpdate(
  ready: Promise<ServiceWorkerRegistration>,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let worker: ServiceWorker | null = null,
      finished = false;
    const finish = (error: unknown, available = false) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      worker?.removeEventListener('statechange', changed);
      if (error) reject(error);
      else resolve(available);
    };
    const abort = () => finish(new Error('Update check cancelled'));
    const changed = () => {
      if (worker?.state === 'installed' || worker?.state === 'activated') finish(null, true);
      else if (worker?.state === 'redundant') finish(new Error('Update installation failed'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void (async () => {
      try {
        const registration = await ready;
        if (finished) return;
        if (registration.waiting) {
          finish(null, true);
          return;
        }
        await registration.update();
        if (finished) return;
        if (registration.waiting) finish(null, true);
        else if (registration.installing) {
          worker = registration.installing;
          worker.addEventListener('statechange', changed);
          changed();
        } else finish(null);
      } catch (error) {
        finish(error);
      }
    })();
  });
}
