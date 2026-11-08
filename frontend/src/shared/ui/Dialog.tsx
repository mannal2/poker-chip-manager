import { useScreenFit } from '../hooks/useScreenFit';
import { useEffect, useRef, type ReactNode } from 'react';
// 모달 대화상자를 표시하고, 닫기가 허용된 경우 취소 이벤트나 설정에 따른 바깥 클릭으로 닫는다
export function Dialog({
  title,
  onClose,
  children,
  actions,
  stackActions = false,
  dismissOutside = false,
  closeDisabled = false,
  showTitle = true,
  scrollable = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  // 선택지가 여럿이라 한 줄이 좁을 때 버튼을 세로로 쌓고 닫기를 맨 아래에 둔다
  stackActions?: boolean;
  dismissOutside?: boolean;
  closeDisabled?: boolean;
  showTitle?: boolean;
  scrollable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useScreenFit(ref, scrollable);
  const startedOutside = useRef(false);
  function outside(x: number, y: number) {
    const r = ref.current!.getBoundingClientRect();
    return x < r.left || x > r.right || y < r.top || y > r.bottom;
  }
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={scrollable ? 'scrollable' : undefined}
      aria-label={title}
      onPointerDown={(e) => {
        startedOutside.current = outside(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        if (
          !closeDisabled &&
          dismissOutside &&
          startedOutside.current &&
          outside(e.clientX, e.clientY)
        )
          onClose();
        startedOutside.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!closeDisabled) onClose();
      }}
    >
      {showTitle && <h2>{title}</h2>}
      {children}
      {(actions || !dismissOutside) && (
        <div className={stackActions ? 'dialog-actions stacked' : 'dialog-actions'}>
          {!dismissOutside && (
            <button className="dialog-close" disabled={closeDisabled} onClick={onClose}>
              닫기
            </button>
          )}
          {actions}
        </div>
      )}
    </dialog>
  );
}
