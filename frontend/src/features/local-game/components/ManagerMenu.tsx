// 홈 이동, 바이인, 새 토너먼트 시작 메뉴
export function ManagerMenu({
  onHome,
  onBuyIn,
  buyInBlockReason,
  onNew,
}: {
  onHome: () => void;
  onBuyIn: () => void;
  buyInBlockReason: string | null;
  onNew: () => void;
}) {
  return (
    <div className="menu-actions">
      <button onClick={onHome}>홈</button>
      <button aria-disabled={buyInBlockReason ? true : undefined} onClick={onBuyIn}>
        바이인
      </button>
      <button onClick={onNew}>새 토너먼트</button>
    </div>
  );
}
