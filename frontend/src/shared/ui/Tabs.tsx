import type { KeyboardEvent } from 'react';

// 탭 목록을 그리고 좌우 화살표로 탭을 옮긴다(패널은 호출하는 쪽이 그린다)
export function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
  disabled,
  label,
  idPrefix,
}: {
  tabs: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
  disabled?: boolean;
  label: string;
  idPrefix: string;
}) {
  // 왼쪽·오른쪽 화살표로 이웃 탭을 고르고 포커스한다
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.id === selected);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${next.id}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${idPrefix}-tab-${t.id}`}
          role="tab"
          type="button"
          aria-selected={selected === t.id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={selected === t.id ? 0 : -1}
          disabled={disabled}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
