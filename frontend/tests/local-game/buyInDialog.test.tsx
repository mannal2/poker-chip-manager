// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BuyInDialog } from '../../src/features/local-game/components/BuyInDialog';
import { apply, fixtureState } from '../game/helpers';
import type { GameState } from '../../src/game/types';

let host: HTMLDivElement;
let root: Root;
// 대화상자를 그릴 화면을 준비한다
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
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
// 입력 값을 바꾸고 input 이벤트를 보낸다
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
// 대화상자를 그린다
async function show(state: GameState, onSubmit = vi.fn(async () => true)) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  await act(() =>
    root.render(
      <BuyInDialog
        state={state}
        busy={false}
        onSubmit={onSubmit}
        onClose={onClose}
        onDone={onDone}
      />,
    ),
  );
  return { onSubmit, onClose, onDone };
}
// 글자로 버튼을 찾는다
function button(text: string) {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
}
// 한 명이 탈락한 상태를 만든다
function eliminated(): GameState {
  const s = structuredClone(fixtureState(3));
  s.players[1].eliminated = true;
  s.players[1].stack = 0;
  return s;
}

// 처음에는 새 플레이어 탭이 열려 있다
it('opens on the new player tab', async () => {
  await show(fixtureState(3));
  expect(button('새 플레이어').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('input[type="text"], input:not([type])')).not.toBeNull();
  expect(host.textContent).toContain('한글·영문·숫자·공백 1~10자로 정해 주세요.');
});

// 이름 규칙 오류를 입력 칸 아래에 띄운다
it('shows the name rule error under the field', async () => {
  await show(fixtureState(3));
  const input = host.querySelector<HTMLInputElement>('input')!;
  await act(() => type(input, 'a!'));
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toBeTruthy();
  expect(input.getAttribute('aria-describedby')).toContain(alert!.id);
  expect(button('바이인').disabled).toBe(true);
});

// 재입장을 고르면 원래 자리가 미리 골라진다
it('preselects the original seat for a re-entry', async () => {
  await show(eliminated());
  await act(() => button('재입장').click());
  await act(() => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  expect(host.querySelector<HTMLSelectElement>('select')!.selectedOptions[0].textContent).toBe(
    'B의 빈자리',
  );
});

// 탈락자가 없으면 안내만 보인다
it('says there is nobody to re-enter', async () => {
  await show(fixtureState(3));
  await act(() => button('재입장').click());
  expect(host.textContent).toContain('재입장할 탈락자가 없습니다.');
});

// 고른 자리로 BUY_IN을 보내고 성공하면 닫는다
it('sends BUY_IN with the chosen seat', async () => {
  const { onSubmit, onClose, onDone } = await show(fixtureState(3));
  await act(() => type(host.querySelector<HTMLInputElement>('input')!, 'Zed'));
  const select = host.querySelector<HTMLSelectElement>('select')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      select,
      'between:p1',
    );
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('바이인').click());
  expect(onSubmit).toHaveBeenCalledWith({
    type: 'BUY_IN',
    name: 'Zed',
    placement: { kind: 'between', after: 'p1' },
  });
  expect(onClose).toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledWith('Zed');
});

// 대기 중인 바이인을 목록에서 취소한다
it('cancels a waiting buy-in', async () => {
  const s = apply(fixtureState(3), {
    type: 'BUY_IN',
    name: 'Zed',
    placement: { kind: 'between', after: 'p0' },
  });
  const { onSubmit } = await show(s);
  expect(host.textContent).toContain('대기 중인 바이인');
  await act(async () => button('바이인 취소').click());
  expect(onSubmit).toHaveBeenCalledWith({
    type: 'CANCEL_BUY_IN',
    playerId: s.players.find((p) => p.joining)!.id,
  });
});
