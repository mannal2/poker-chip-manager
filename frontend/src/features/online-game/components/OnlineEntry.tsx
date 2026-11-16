import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { EntryField, OnlineController, OnlineView } from '../session/onlineController';

// 영문과 숫자만 남긴 뒤 소문자를 대문자로 바꾼다
function normalizeCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

const NAME_HELP = '다른 플레이어에게 보이는 이름입니다. 한글·영문·숫자·공백 1~10자로 정해 주세요.';
const TABS = [
  { id: 'create', label: '방 만들기' },
  { id: 'join', label: '방 참가' },
] as const;
type Tab = (typeof TABS)[number]['id'];

// 입력 칸 하나와 그 아래의 도움말 또는 칸 오류를 그린다
function EntryInput({
  field,
  label,
  error,
  help,
  children,
}: {
  field: EntryField;
  label: string;
  error: string | null;
  help?: string;
  children: (props: {
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
}) {
  const errorId = `entry-${field}-error`;
  const helpId = `entry-${field}-help`;
  const describedBy = error ? errorId : help ? helpId : undefined;
  return (
    <div className="entry-field">
      <label>
        {label}
        {children({
          ...(error ? { 'aria-invalid': true as const } : {}),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        })}
      </label>
      {error ? (
        <p role="alert" id={errorId} className="field-error">
          {error}
        </p>
      ) : (
        help && (
          <p id={helpId} className="entry-help">
            {help}
          </p>
        )
      )}
    </div>
  );
}

// 방 만들기와 방 참가를 탭으로 나눠 입력을 받고 기존 자리 복구를 제공한다
export function OnlineEntry({
  view,
  controller,
}: {
  view: OnlineView;
  controller: OnlineController;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(() =>
    normalizeCode(new URLSearchParams(location.search).get('code') ?? ''),
  );
  const [tab, setTab] = useState<Tab>(() => (code ? 'join' : 'create'));
  if (view.phase === 'recovering' && view.recovery?.status === 'PENDING')
    return <p role="status">방장의 승인을 기다리고 있습니다.</p>;
  const fieldError = (field: EntryField) => (view.errorField === field ? view.error : null);
  // 탭을 바꾸고 이전 탭에서 남은 칸 오류를 지운다
  const choose = (next: Tab) => {
    if (next === tab) return;
    controller.clearFieldError('name');
    controller.clearFieldError('code');
    setTab(next);
  };
  // 왼쪽·오른쪽 화살표로 탭을 옮긴다
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'create' ? 'join' : 'create';
    choose(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#entry-tab-${next}`)?.focus();
  };
  const nameInput = (
    <EntryInput field="name" label="내 이름" error={fieldError('name')} help={NAME_HELP}>
      {(aria) => (
        <input
          name="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            controller.clearFieldError('name');
          }}
          disabled={view.pending}
          {...aria}
        />
      )}
    </EntryInput>
  );
  return (
    <>
      <div className="entry-tabs" role="tablist" aria-label="입장 방법" onKeyDown={moveTab}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`entry-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls="entry-panel"
            tabIndex={tab === t.id ? 0 : -1}
            disabled={view.pending}
            onClick={() => choose(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="entry-panel"
        id="entry-panel"
        role="tabpanel"
        aria-labelledby={`entry-tab-${tab}`}
      >
        {tab === 'create' ? (
          <>
            {nameInput}
            <button
              className="primary"
              disabled={view.pending}
              onClick={() => void controller.create(name)}
            >
              방 만들기
            </button>
          </>
        ) : (
          <>
            <EntryInput field="code" label="방 코드" error={fieldError('code')}>
              {(aria) => (
                <input
                  name="code"
                  value={code}
                  onChange={(event) => {
                    setCode(normalizeCode(event.target.value));
                    controller.clearFieldError('code');
                  }}
                  disabled={view.pending}
                  autoCapitalize="characters"
                  {...aria}
                />
              )}
            </EntryInput>
            {nameInput}
            <button
              className="primary"
              disabled={view.pending}
              onClick={() => void controller.join(code, name)}
            >
              방 참가
            </button>
            <p className="entry-help">이전에 이 방에 참가했던 플레이어만 사용할 수 있습니다.</p>
            <button
              disabled={view.pending}
              onClick={() => void controller.requestRecovery(code, name)}
            >
              기존 플레이어로 복구
            </button>
          </>
        )}
      </div>
      {view.phase === 'joining' && <p role="status">방에 연결하고 있습니다.</p>}
      {view.phase === 'recovering' && <p role="status">방장의 승인을 기다리고 있습니다.</p>}
      {view.pending && view.error && (
        <button onClick={() => void controller.retry()}>다시 시도</button>
      )}
    </>
  );
}
