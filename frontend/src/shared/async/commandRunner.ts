export interface RunHooks {
  /** Called instead of the action while another one holds the lock. */
  onBusy?: () => void;
  onStart?: () => void;
  onError?: (error: unknown) => void;
  /** Runs after the lock is released, including after errors. */
  onRelease?: () => void;
}

/** One-at-a-time async runner: storage saves locally, awaited server replies online. */
export function createCommandRunner() {
  let locked = false;
  async function run(action: () => Promise<void>, hooks: RunHooks = {}) {
    if (locked) {
      hooks.onBusy?.();
      return;
    }
    locked = true;
    hooks.onStart?.();
    try {
      await action();
    } catch (error) {
      hooks.onError?.(error);
    } finally {
      locked = false;
      hooks.onRelease?.();
    }
  }
  return { run, isLocked: () => locked };
}
