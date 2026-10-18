import { it, expect } from 'vitest';
import { checkForUpdate } from '../../src/pwa/checkUpdate';
function fixture() {
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const registration = {
    waiting: null as unknown,
    installing: null as unknown,
    update: async () => {
      registration.installing = worker;
    },
  };
  return {
    worker,
    registration,
    ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration),
  };
}
it('새 파일 설치가 끝나기 전 최신/준비 완료를 반환하지 않음', async () => {
  const { worker, registration, ready } = fixture();
  let done = false;
  const p = checkForUpdate(ready, new AbortController().signal).then((v) => {
    done = true;
    return v;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(done).toBe(false);
  registration.waiting = worker;
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  expect(await p).toBe(true);
});
it('새 워커가 없을 때만 최신 상태', async () => {
  const { registration, ready } = fixture();
  registration.update = async () => {};
  expect(await checkForUpdate(ready, new AbortController().signal)).toBe(false);
});
it('설치 실패는 최신 상태가 아니라 실패', async () => {
  const { worker, ready } = fixture();
  const p = checkForUpdate(ready, new AbortController().signal);
  const fail = expect(p).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  worker.state = 'redundant';
  worker.dispatchEvent(new Event('statechange'));
  await fail;
});
it('닫기/시간 초과 후 늦은 준비 완료를 반영하지 않음', async () => {
  const { worker, ready } = fixture(),
    controller = new AbortController();
  const p = checkForUpdate(ready, controller.signal);
  const fail = expect(p).rejects.toThrow();
  controller.abort();
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  await fail;
});
it('이미 준비된 새 버전은 연결 실패에도 적용 가능', async () => {
  const { worker, registration, ready } = fixture();
  registration.waiting = worker;
  registration.update = async () => {
    throw Error('offline');
  };
  expect(await checkForUpdate(ready, new AbortController().signal)).toBe(true);
});
