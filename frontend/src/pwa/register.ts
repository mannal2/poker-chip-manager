import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { checkForUpdate } from './checkUpdate';
export type UpdateStatus =
  'idle' | 'checking' | 'available' | 'current' | 'error' | 'applyError' | 'applying';
export function useLocalPWA() {
  const [state, setState] = useState({
    offlineReady: false,
    hasUpdate: false,
    offlineError: '',
    updateError: '',
    updateStatus: 'idle' as UpdateStatus,
  });
  const checkController = useRef<AbortController | null>(null),
    applying = useRef(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const registerAgain = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setState((s) => ({
        ...s,
        offlineError: '이 브라우저에서는 인터넷 없이 사용할 수 없습니다.',
      }));
      return;
    }
    async function ready() {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          }),
        );
      const shell = await caches.match('/local/index.html', { ignoreSearch: true });
      if (shell) setState((s) => ({ ...s, offlineReady: true, offlineError: '' }));
    }
    const register = () => {
      registerSW({
        immediate: true,
        onOfflineReady() {
          void ready();
        },
        onNeedRefresh() {
          setState((s) => ({
            ...s,
            hasUpdate: true,
            updateStatus: s.updateStatus === 'current' ? 'available' : s.updateStatus,
          }));
        },
        onNeedReload() {
          setState((s) => ({
            ...s,
            hasUpdate: true,
            updateStatus: s.updateStatus === 'current' ? 'available' : s.updateStatus,
          }));
        },
        onRegisteredSW(_url, r) {
          registration.current = r ?? null;
          if (!r) return;
          if (r.active) void ready();
          const watch = () => {
            const worker = r.installing;
            if (worker)
              worker.addEventListener('statechange', () => {
                if (worker.state === 'redundant')
                  setState((s) => ({
                    ...s,
                    offlineError:
                      '인터넷 없이 사용할 앱 파일을 저장하지 못했습니다. 인터넷 연결을 확인한 뒤 앱을 다시 열어주세요.',
                  }));
              });
          };
          watch();
          r.addEventListener('updatefound', watch);
        },
        onRegisterError() {
          setState((s) => ({
            ...s,
            offlineError:
              '앱 파일을 저장하지 못했습니다. 인터넷 연결을 확인한 뒤 앱을 다시 열어주세요.',
          }));
        },
      });
    };
    registerAgain.current = register;
    register();
    return () => {
      registerAgain.current = null;
      const controller = checkController.current;
      checkController.current = null;
      controller?.abort();
    };
  }, []);
  function cancelCheck() {
    const controller = checkController.current;
    checkController.current = null;
    controller?.abort();
  }
  async function check() {
    if (applying.current) return;
    cancelCheck();
    const controller = new AbortController();
    checkController.current = controller;
    setState((s) => ({ ...s, updateStatus: 'checking', updateError: '' }));
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (!('serviceWorker' in navigator)) throw Error('Unsupported');
      const readyRegistration = (async () => {
        const r =
          registration.current ?? (await navigator.serviceWorker.getRegistration('/local/'));
        if (!navigator.onLine && !r?.waiting) throw Error('Offline');
        if (!r?.active && !r?.installing && !r?.waiting) {
          if (!navigator.serviceWorker.controller) {
            // Failed first installs can leave a partial precache in WebKit.
            const scope = new URL('/local/', location.origin).href;
            for (const name of await caches.keys())
              if (name.startsWith('workbox-precache-') && name.endsWith(scope))
                await caches.delete(name);
          }
          registerAgain.current?.();
        }
        return r?.active ? r : navigator.serviceWorker.ready;
      })();
      const available = await checkForUpdate(readyRegistration, controller.signal);
      if (checkController.current === controller)
        setState((s) => ({
          ...s,
          hasUpdate: available || s.hasUpdate,
          updateStatus: available || s.hasUpdate ? 'available' : 'current',
          updateError: '',
        }));
    } catch {
      if (checkController.current === controller)
        setState((s) => ({
          ...s,
          updateStatus: 'error',
          updateError: '인터넷 연결을 확인한 뒤 다시 시도해주세요.',
        }));
    } finally {
      clearTimeout(timer);
      if (checkController.current === controller) checkController.current = null;
    }
  }
  async function apply(beforeApply: () => Promise<unknown>) {
    if (applying.current) return;
    applying.current = true;
    cancelCheck();
    setState((s) => ({ ...s, updateStatus: 'applying', updateError: '' }));
    try {
      await beforeApply();
      const r = registration.current ?? (await navigator.serviceWorker.getRegistration('/local/'));
      if (!r) throw Error('Registration missing');
      const worker = r.waiting;
      if (worker)
        await new Promise<void>((resolve, reject) => {
          let done = false;
          const finish = (error?: Error) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            worker.removeEventListener('statechange', changed);
            if (error) reject(error);
            else resolve();
          };
          const changed = () => {
            if (worker.state === 'activated') finish();
            else if (worker.state === 'redundant') finish(new Error('Activation failed'));
          };
          const timer = setTimeout(() => finish(new Error('Activation timed out')), 30000);
          worker.addEventListener('statechange', changed);
          try {
            worker.postMessage({ type: 'SKIP_WAITING' });
            changed();
          } catch {
            finish(new Error('Activation failed'));
          }
        });
      location.reload();
    } catch {
      setState((s) => ({
        ...s,
        updateStatus: 'applyError',
        updateError: '잠시 후 다시 시도해주세요.',
      }));
    } finally {
      applying.current = false;
    }
  }
  return { ...state, check, apply, cancelCheck };
}
