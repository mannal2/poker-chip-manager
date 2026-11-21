// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHandStartCue } from '../../src/features/gameplay/hooks/useHandStartCue';
import type { GameSession } from '../../src/features/gameplay/session';

let host: HTMLDivElement;
let root: Root;
// 훅을 그릴 화면을 준비한다
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
// 화면과 대체한 전역을 정리한다
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// 훅이 돌려준 값을 글자로 보여 준다
function Probe({ hand, reveal }: { hand?: number; reveal?: GameSession['boardReveal'] }) {
  return <output>{useHandStartCue(hand, reveal)}</output>;
}
// 핸드 번호를 바꿔 그리고 훅 값을 읽는다
async function cueAt(hand?: number, reveal?: GameSession['boardReveal']) {
  await act(() => root.render(<Probe hand={hand} reveal={reveal} />));
  return Number(host.textContent);
}

// 핸드 번호가 커질 때만 신호를 하나씩 늘린다
it('counts only hand number increases', async () => {
  expect(await cueAt(1)).toBe(0);
  expect(await cueAt(1)).toBe(0);
  expect(await cueAt(2)).toBe(1);
  expect(await cueAt(3)).toBe(2);
  // 무르기로 핸드 번호가 줄면 재생하지 않는다
  expect(await cueAt(2)).toBe(2);
  expect(await cueAt(undefined)).toBe(2);
  expect(await cueAt(4)).toBe(2);
  expect(await cueAt(5)).toBe(3);
});

// 온라인에서 직전 화면과 이어지지 않는 상태로 건너뛰면(재접속·재동기화) 재생하지 않는다
it('skips a jump that does not follow the rendered version', async () => {
  expect(await cueAt(1, { version: 10, from: null })).toBe(0);
  expect(await cueAt(2, { version: 11, from: 10 })).toBe(1);
  expect(await cueAt(3, { version: 20, from: 15 })).toBe(1);
  expect(await cueAt(4, { version: 21, from: 20 })).toBe(2);
});
