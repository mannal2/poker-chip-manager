import { useScreenFit } from '../hooks/useScreenFit';
import { useEffect, useRef, type ReactNode } from 'react';
export function Dialog({
  title,
  onClose,
  children,
  dismissOutside = false,
  closeDisabled = false,
  showTitle = true,
  scrollable = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
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
      {!dismissOutside && (
        <button disabled={closeDisabled} onClick={onClose}>
          닫기
        </button>
      )}
    </dialog>
  );
}
