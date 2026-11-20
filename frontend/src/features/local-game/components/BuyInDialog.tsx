import { useId, useRef, useState } from 'react';
import { Dialog } from '../../../shared/ui/Dialog';
import { Tabs } from '../../../shared/ui/Tabs';
import { normalizeName, renameError } from '../../../game/settings';
import { messageFor } from '../../gameplay/model/errorMessages';
import { seatOptions, type SeatOption } from '../model/buyIn';
import type { GameCommand, GameState } from '../../../game/types';
import '../styles/buyIn.css';

type Mode = 'new' | 'reentry';
const TABS: readonly { id: Mode; label: string }[] = [
  { id: 'new', label: '새 플레이어' },
  { id: 'reentry', label: '재입장' },
];

// 같은 이름은 가장 높은 입장 번호 하나로 모아 재입장 대상 목록을 만든다
function reentryCandidates(state: GameState): { id: string; name: string; seated: boolean }[] {
  const best = new Map<string, { id: string; name: string; entry: number; seated: boolean }>();
  const consider = (c: { id: string; name: string; entry: number; seated: boolean }) => {
    const key = c.name.toLowerCase();
    const old = best.get(key);
    if (!old || c.entry > old.entry || (c.entry === old.entry && c.seated && !old.seated))
      best.set(key, c);
  };
  for (const p of state.players)
    if (p.eliminated && !p.joining)
      consider({ id: p.id, name: p.name, entry: p.entry ?? 1, seated: true });
  for (const f of state.formerPlayers ?? [])
    if (f.reason === 'replaced')
      consider({ id: f.id, name: f.name, entry: f.entry, seated: false });
  const alive = new Set(
    state.players.filter((p) => !p.eliminated).map((p) => p.name.toLowerCase()),
  );
  return [...best.entries()]
    .filter(([key]) => !alive.has(key))
    .map(([, c]) => ({ id: c.id, name: c.name, seated: c.seated }));
}

// 앉을 자리를 고르는 선택칸
function SeatField({
  options,
  seat,
  busy,
  onChange,
}: {
  options: SeatOption[];
  seat: SeatOption | undefined;
  busy: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <div className="fields">
      <label>
        자리
        <select value={seat?.key ?? ''} disabled={busy} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// 탭 내용 하나를 그리고 안 보이는 탭은 자리만 차지하게 숨긴다
function Panel({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  return (
    <div className={shown ? undefined : 'inactive'} aria-hidden={shown ? undefined : true} inert={!shown}>
      {children}
    </div>
  );
}

// 새 플레이어나 탈락자를 자리에 앉히고 대기 중인 바이인을 취소하는 대화상자
export function BuyInDialog({
  state,
  busy,
  onSubmit,
  onClose,
  onDone,
}: {
  state: GameState;
  busy: boolean;
  onSubmit: (command: GameCommand) => Promise<boolean>;
  onClose: () => void;
  onDone?: (name: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('new');
  const [name, setName] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [seatKey, setSeatKey] = useState('');
  // 준비되지 않은 채 바이인을 눌렀는지. 빈 입력을 그 칸에서 안내하는 데 쓴다
  const [asked, setAsked] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const pickErrorId = useId();
  const options = seatOptions(state);
  const seat = options.find((o) => o.key === seatKey) ?? options[0];
  const candidates = reentryCandidates(state);
  const person = candidates.find((c) => c.id === target);
  const others = state.players.filter((p) => !p.eliminated).map((p) => p.name);
  const code = mode === 'new' && name !== '' ? renameError(name, others) : null;
  const error = code ? messageFor(code) : asked && mode === 'new' && name === '' ?'이름을 입력해 주세요.' : '';
  const pickError = asked && mode === 'reentry' && candidates.length > 0 && !person;
  // 재입장은 원래 자리로만 하고, 원래 자리를 다른 플레이어가 차지했을 때만 자리를 고른다
  const placement =
    mode === 'reentry' && person?.seated
      ? { kind: 'replace' as const, playerId: person.id }
      : seat?.placement;
  const ready =
    !busy && !!placement && (mode === 'new' ? name !== '' && !code : person !== undefined);
  const waiting = state.players.filter((p) => p.joining);

  // 입력한 내용으로 바이인 명령을 보내고 성공하면 닫는다
  async function submit() {
    if (busy) return;
    if (!ready || !placement) {
      // 무엇이 빠졌는지 해당 칸에서 알려 주고 이름 칸이면 그 칸으로 옮긴다
      setAsked(true);
      if (mode === 'new') nameInput.current?.focus();
      return;
    }
    const command: GameCommand =
      mode === 'new'
        ? { type: 'BUY_IN', name, placement }
        : { type: 'BUY_IN', placement, reentryOf: person!.id };
    if (!(await onSubmit(command))) return;
    const done = mode === 'new' ? (normalizeName(name) ?? name.trim()) : person!.name;
    onClose();
    onDone?.(done);
  }

  return (
    <Dialog
      title="바이인"
      scrollable
      onClose={onClose}
      actions={
        <button className="primary" aria-disabled={!ready} onClick={() => void submit()}>
          바이인
        </button>
      }
    >
      <div className="buy-in">
        {waiting.length > 0 && (
          <section>
            <h3>대기 중인 바이인</h3>
            <ul className="waiting">
              {waiting.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <button
                    disabled={busy}
                    onClick={() => void onSubmit({ type: 'CANCEL_BUY_IN', playerId: p.id })}
                  >
                    바이인 취소
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Tabs
          tabs={TABS}
          selected={mode}
          onSelect={(next) => {
            setMode(next);
            setAsked(false);
          }}
          disabled={busy}
          label="바이인 방식"
          idPrefix="buy-in"
        />
        <div role="tabpanel" id="buy-in-panel" aria-labelledby={`buy-in-tab-${mode}`}>
          <div className="buy-in-panels">
            <Panel shown={mode === 'new'}>
              <div className="fields">
                <label>
                  이름
                  <input
                    ref={nameInput}
                    value={name}
                    disabled={busy}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {/* 오류는 도움말 자리에 겹쳐 띄우고 도움말은 가리기만 해서 창 높이가 바뀌지 않게 한다 */}
                  <span className="field-note">
                    <span className={error ? 'hint covered' : 'hint'} aria-hidden={error ? true : undefined}>
                      다른 플레이어에게 보이는 이름입니다. 한글·영문·숫자·공백 1~10자로 정해 주세요.
                    </span>
                    {error && (
                      <span id={errorId} className="field-error" role="alert">
                        {error}
                      </span>
                    )}
                  </span>
                </label>
              </div>
              <SeatField options={options} seat={seat} busy={busy} onChange={setSeatKey} />
            </Panel>
            <Panel shown={mode === 'reentry'}>
              {candidates.length === 0 ? (
                <p>재입장할 탈락자가 없습니다.</p>
              ) : (
                <div
                  className="reentry-list"
                  role="radiogroup"
                  aria-label="재입장할 탈락자"
                  aria-invalid={pickError ? true : undefined}
                  aria-describedby={pickError ? pickErrorId : undefined}
                >
                  {candidates.map((c) => (
                    <label key={c.id}>
                      <span>{c.name}</span>
                      <input
                        type="radio"
                        name="reentry"
                        checked={target === c.id}
                        disabled={busy}
                        onChange={() => setTarget(c.id)}
                      />
                    </label>
                  ))}
                </div>
              )}
              {pickError && (
                <p id={pickErrorId} className="field-error" role="alert">
                  재입장할 탈락자를 골라 주세요.
                </p>
              )}
              {person?.seated && <p className="hint">원래 자리로 돌아갑니다.</p>}
              {person && !person.seated && (
                <>
                  <p className="hint">
                    원래 자리에 다른 플레이어가 앉아 있습니다. 앉을 자리를 골라 주세요.
                  </p>
                  <SeatField options={options} seat={seat} busy={busy} onChange={setSeatKey} />
                </>
              )}
            </Panel>
          </div>
        </div>
        <p className="guide">
          시작 칩 {state.settings.initial.toLocaleString('ko-KR')}을 받고 다음 핸드부터 참여합니다.
          버튼과 스몰 블라인드 사이 자리면 버튼이 지나간 뒤 참여합니다.
        </p>
      </div>
    </Dialog>
  );
}
