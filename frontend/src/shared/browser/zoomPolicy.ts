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
