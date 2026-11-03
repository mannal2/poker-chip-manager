// 휠/키보드/제스처로 인한 화면 확대를 막는 리스너를 등록한다
// Page lifetime listeners: preserve scrolling and editing, suppress zoom inputs only.
export function installZoomPolicy() {
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.isComposing &&
        ['+', '-', '=', '_', '0'].includes(event.key)
      )
        event.preventDefault();
    },
    { capture: true },
  );
  const preventGesture = (event: Event) => event.preventDefault();
  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
}
