// 비동기 실행의 단계별 콜백(바쁨, 시작, 오류, 해제)
export interface RunHooks {
  /** Called instead of the action while another one holds the lock. */
  onBusy?: () => void;
  onStart?: () => void;
  onError?: (error: unknown) => void;
  /** Runs after the lock is released, including after errors. */
  onRelease?: () => void;
}

// 한 번에 하나씩만 비동기 작업을 실행하는 실행기를 만든다
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
