// 결과 화면에서 방장에게 재준비 확인 동작을 제공한다.
export function ResultActions({
  host,
  busy,
  onReset,
}: {
  host: boolean;
  busy: boolean;
  onReset: () => void;
}) {
  return host ? (
    <button aria-disabled={busy} onClick={onReset}>
      다시 준비하기
    </button>
  ) : null;
}
