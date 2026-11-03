import type { useLocalPWA } from './register';
import { useInstallPrompt } from './useInstallPrompt';

// 설치 안내와 업데이트 안내를 언제 보여줄지 정하는 훅
export function usePwaPresentation({
  pwa,
  home,
  busy,
  dialog,
  updateDeferred,
  setDialog,
  onDeferUpdate,
  isLocked,
  hasPending,
  readSavedState,
  notify,
}: {
  pwa: ReturnType<typeof useLocalPWA>;
  home: boolean;
  busy: boolean;
  dialog: string;
  updateDeferred: boolean;
  setDialog: (dialog: string) => void;
  onDeferUpdate: () => void;
  isLocked: () => boolean;
  hasPending: () => boolean;
  readSavedState: () => Promise<unknown>;
  notify: (message: string) => void;
}) {
  const install = useInstallPrompt(home && !busy && !dialog);
  const automatic =
    dialog === 'startupUpdate' ||
    (home && !busy && !dialog && pwa.hasUpdate && !updateDeferred && !install.visible);

  // 업데이트 창을 열고 새 버전을 확인한다
  function openUpdate() {
    setDialog('update');
    void pwa.check();
  }

  // 업데이트 창을 닫고 확인을 취소한다
  function closeUpdate() {
    if (pwa.hasUpdate) onDeferUpdate();
    pwa.cancelCheck();
    setDialog('');
  }

  // 새 버전 확인을 다시 시작한다
  function checkUpdate() {
    void pwa.check();
  }

  // 저장이 끝난 홈 화면에서만 업데이트를 적용한다
  function applyUpdate() {
    if (!home || busy || isLocked() || hasPending())
      return notify('저장 완료 후 홈에서 업데이트하세요.');
    if (automatic) setDialog('startupUpdate');
    void pwa.apply(readSavedState);
  }

  return {
    install,
    update: {
      visible: dialog === 'update' || automatic,
      automatic,
      canApply: home && !busy && !hasPending() && !isLocked(),
      closeDisabled: pwa.updateStatus === 'applying',
      open: openUpdate,
      close: closeUpdate,
      check: checkUpdate,
      apply: applyUpdate,
    },
  };
}
