import type { UpdateStatus } from './register';
export function UpdateNotice({
  updateStatus,
  updateError,
  canApply,
  onCheck,
  onApply,
}: {
  updateStatus: UpdateStatus;
  updateError: string;
  canApply: boolean;
  onCheck: () => void;
  onApply: () => void;
}) {
  const message = {
    idle: '업데이트를 확인하고 있습니다…',
    checking: '업데이트를 확인하고 있습니다…',
    available: '새 버전이 준비되었습니다.',
    current: '최신 버전을 사용하고 있습니다.',
    error: '업데이트를 확인하지 못했습니다.',
    applyError: '업데이트를 적용하지 못했습니다.',
    applying: '업데이트하고 있습니다…',
  }[updateStatus];
  return (
    <>
      <p role="status">{message}</p>
      {updateStatus === 'available' && (
        <p>업데이트 후 앱이 다시 열립니다. 진행 중인 게임은 유지됩니다.</p>
      )}
      {updateStatus === 'applying' && <p>잠시 후 앱이 다시 열립니다.</p>}
      {(updateStatus === 'error' || updateStatus === 'applyError') && <p>{updateError}</p>}
      {updateStatus === 'available' && (
        <div className="actions">
          <button className="primary" disabled={!canApply} onClick={onApply}>
            업데이트하기
          </button>
        </div>
      )}
      {(updateStatus === 'error' || updateStatus === 'applyError') && (
        <button onClick={onCheck}>다시 시도</button>
      )}
    </>
  );
}
