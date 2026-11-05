import { useState } from 'react';
import type { OnlineController, OnlineView } from '../session/onlineController';

// 영문과 숫자만 남긴 뒤 소문자를 대문자로 바꾼다
function normalizeCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// 방 생성과 참가 및 기존 자리 복구 입력을 제공한다
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
  if (view.phase === 'recovering' && view.recovery?.status === 'PENDING')
    return <p role="status">방장의 승인을 기다리고 있습니다</p>;
  return (
    <>
      <label>
        이름
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={view.pending}
        />
      </label>
      <button
        className="primary"
        disabled={view.pending}
        onClick={() => void controller.create(name)}
      >
        방 만들기
      </button>
      <label>
        방 코드
        <input
          name="code"
          value={code}
          onChange={(event) => setCode(normalizeCode(event.target.value))}
          disabled={view.pending}
          autoCapitalize="characters"
        />
      </label>
      <button disabled={view.pending} onClick={() => void controller.join(code, name)}>
        방 참가
      </button>
      <button disabled={view.pending} onClick={() => void controller.requestRecovery(code, name)}>
        기존 참가자로 복구
      </button>
      {view.phase === 'joining' && <p role="status">방에 연결하고 있습니다</p>}
      {view.phase === 'recovering' && <p role="status">방장의 승인을 기다리고 있습니다</p>}
      {view.pending && view.error && (
        <button onClick={() => void controller.retry()}>다시 시도</button>
      )}
    </>
  );
}
