// A suspended or broken IndexedDB request must not leave the app waiting forever.
export async function storageDeadline<T>(promise: Promise<T>, phase: string, cancel = () => {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new Error(`저장 상태를 확인하지 못했습니다 (${phase}). 다시 시도해주세요.`));
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
