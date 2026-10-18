export function ManagerMenu({ onHome, onNew }: { onHome: () => void; onNew: () => void }) {
  return (
    <div className="menu-actions">
      <button onClick={onHome}>홈</button>
      <button onClick={onNew}>새 토너먼트</button>
    </div>
  );
}
