import { useRef, useState } from 'react';
export function InlineName({
  name,
  busy,
  onSave,
  onEditing,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => boolean;
  onEditing: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(name);
  const composing = useRef(false),
    skipBlur = useRef(false);
  function close() {
    setEditing(false);
    onEditing(false);
  }
  function save() {
    if (skipBlur.current || composing.current || busy) return;
    if (onSave(draft)) {
      skipBlur.current = true;
      close();
    }
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
          onChange={(e) => setDraft(e.target.value)}
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
            setDraft(name);
            setEditing(true);
            onEditing(true);
          }}
        >
          {name}
        </button>
      )}
    </span>
  );
}
