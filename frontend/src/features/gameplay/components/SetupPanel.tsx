import { useState, useRef } from 'react';
import type { GameSettings } from '../../../game/settings';
import { validateSettings } from '../../../game/settings';
import { messageFor } from '../model/errorMessages';
export function SetupPanel({
  settings,
  busy,
  onSave,
  onStart,
}: {
  settings: GameSettings;
  busy: boolean;
  onSave: (s: GameSettings) => void;
  onStart: (s: GameSettings) => void;
}) {
  const [draft, setDraft] = useState({
      initial: String(settings.initial),
      sb: String(settings.sb),
      bb: String(settings.bb),
    }),
    [error, setError] = useState('');
  const composing = useRef(false);
  function values() {
    return {
      ...settings,
      initial: Number(draft.initial),
      sb: Number(draft.sb),
      bb: Number(draft.bb),
    };
  }
  function save() {
    if (composing.current) return;
    const s = values(),
      v = validateSettings(s);
    setError(v.ok ? '' : messageFor(v.code));
    if (v.ok && JSON.stringify(s) !== JSON.stringify(settings)) onSave(v.settings);
  }
  return (
    <>
      <form
        id="setupForm"
        onSubmit={(e) => {
          e.preventDefault();
          const v = validateSettings(values());
          if (v.ok) {
            setError('');
            onStart(v.settings);
          } else setError(messageFor(v.code));
        }}
      >
        <fieldset disabled={busy} className="setup-fields">
          {(['initial', 'sb', 'bb'] as const).map((key, i) => (
            <label key={key}>
              <span>{['시작 칩', 'SB', 'BB'][i]}</span>
              <input
                aria-label={['시작 칩', 'SB', 'BB'][i]}
                inputMode="numeric"
                value={draft[key]}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={() => (composing.current = false)}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                onBlur={save}
              />
            </label>
          ))}
        </fieldset>
      </form>
      {error && (
        <div role="alert" className="field-error">
          {error}
        </div>
      )}
      <button
        className="primary"
        form="setupForm"
        aria-disabled={busy}
        onPointerDown={(e) => e.preventDefault()}
      >
        게임 시작
      </button>
    </>
  );
}
