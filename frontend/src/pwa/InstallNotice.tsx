import { Dialog } from '../ui/Dialog';
import type { useInstallPrompt } from './useInstallPrompt';

export function InstallNotice({ install }: { install: ReturnType<typeof useInstallPrompt> }) {
  if (!install.visible) return null;
  return (
    <Dialog
      dismissOutside
      title="앱으로 설치해서 사용하세요"
      onClose={install.close}
      closeDisabled={install.pending}
    >
      <p>홈 화면에서 바로 실행할 수 있어요.</p>
      {install.error && <p role="alert">{install.error}</p>}
      {install.mode === 'ios' ? (
        <p>
          Safari의 공유 버튼을 누르고 <strong>홈 화면에 추가</strong>를 선택한 뒤 추가하세요.
        </p>
      ) : !install.canPrompt && !install.pending ? (
        <p>
          브라우저 메뉴(⋮)에서 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를
          선택하세요.
        </p>
      ) : null}
      <div className="install-actions">
        {install.canPrompt && (
          <button
            className="primary"
            disabled={install.pending}
            onClick={() => void install.install()}
          >
            앱 설치
          </button>
        )}
        {install.pending && <p role="status">설치 창에서 선택해주세요.</p>}
        <button disabled={install.pending} onClick={install.close}>
          나중에
        </button>
      </div>
    </Dialog>
  );
}
