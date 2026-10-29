import type { useLocalPWA } from './register';
import { useInstallPrompt } from './useInstallPrompt';

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

  function openUpdate() {
    setDialog('update');
    void pwa.check();
  }

  function closeUpdate() {
    if (pwa.hasUpdate) onDeferUpdate();
    pwa.cancelCheck();
    setDialog('');
  }

  function checkUpdate() {
    void pwa.check();
  }

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
