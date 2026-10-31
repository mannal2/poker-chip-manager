import { useLayoutEffect, useRef, useState } from 'react';
// 이름을 그 자리에서 눌러 수정하는 입력 컴포넌트
export function InlineName({
  name,
  busy,
  onSave,
  onEditing,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => boolean | Promise<boolean>;
  onEditing: (editing: boolean, finish?: () => Promise<boolean>) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(name);
  const composing = useRef(false),
    skipBlur = useRef(false),
    value = useRef(name),
    pending = useRef<Promise<boolean> | null>(null),
    editingCallback = useRef(onEditing);
  useLayoutEffect(() => {
    editingCallback.current = onEditing;
  });
  useLayoutEffect(() => () => editingCallback.current(false), []);
  // 편집 모드를 닫고 편집 종료를 알린다
  function close() {
    setEditing(false);
    onEditing(false);
  }
  // 입력한 이름을 저장하고 저장 결과를 돌려준다
  function save(): Promise<boolean> {
    if (pending.current) return pending.current;
    if (skipBlur.current || composing.current || busy) return Promise.resolve(false);
    const result = onSave(value.current);
    if (result === false) return Promise.resolve(false);
    skipBlur.current = true;
    close();
    pending.current = Promise.resolve(result).then((saved) => {
      pending.current = null;
      return saved;
    });
    return pending.current;
  }
  return (
    <span
      className="inline-name"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {editing ? (
        <input
          autoFocus
          aria-label={name + ' 이름 수정'}
          disabled={busy}
          value={draft}
          maxLength={10}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            value.current = e.target.value;
            setDraft(value.current);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              skipBlur.current = true;
              close();
            } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing.current) {
              e.preventDefault();
              save();
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={name + ' 이름 수정'}
          disabled={busy}
          onClick={() => {
            skipBlur.current = false;
            value.current = name;
            setDraft(name);
            setEditing(true);
            onEditing(true, save);
          }}
        >
          {name}
        </button>
      )}
    </span>
  );
}
