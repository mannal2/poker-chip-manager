// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InlineName } from '../../src/features/gameplay/components/InlineName';

let host: HTMLDivElement;
let root: Root;
// 이름 편집 컴포넌트를 그릴 화면을 준비한다
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
// React가 변경을 감지하도록 입력 값을 바꾸고 input 이벤트를 보낸다
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
// 이름 편집을 열고 새 이름을 입력한 뒤 Enter로 저장한다
async function editAndSave(onSave: (name: string) => boolean | string) {
  await act(() =>
    root.render(<InlineName name="Ann" busy={false} onSave={onSave} onEditing={() => {}} />),
  );
  await act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  const input = host.querySelector<HTMLInputElement>('input')!;
  await act(() => type(input, 'Bob'));
  await act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  return input;
}

// 저장이 문구로 거절되면 편집을 유지하고 입력 아래에 이유를 띄운다
it('keeps editing and shows the reason when saving is refused with a message', async () => {
  const input = await editAndSave(() => '같은 이름이 이미 있습니다.');
  expect(host.querySelector('input')).toBe(input);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('같은 이름이 이미 있습니다.');
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
// 다시 입력하면 거절 문구가 사라진다
it('clears the refusal message on the next edit', async () => {
  const input = await editAndSave(() => '같은 이름이 이미 있습니다.');
  await act(() => type(input, 'Bo'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(input.getAttribute('aria-invalid')).toBeNull();
});
// 저장에 성공하면 편집을 닫는다
it('closes the editor when saving succeeds', async () => {
  await editAndSave(() => true);
  expect(host.querySelector('input')).toBeNull();
});
