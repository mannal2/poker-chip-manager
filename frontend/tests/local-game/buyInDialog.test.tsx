// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BuyInDialog } from '../../src/features/local-game/components/BuyInDialog';
import { seatOptions } from '../../src/features/local-game/model/buyIn';
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
  // 칩 총량과 팟 장부가 맞도록 탈락자의 칩과 낸 블라인드를 다른 플레이어에게 옮긴다
  const out = s.players[1];
  s.pot -= out.H;
  s.players[0].stack += out.stack + out.H;
  Object.assign(out, { eliminated: true, folded: true, stack: 0, B: 0, H: 0 });
  s.hand!.pending = s.hand!.pending.filter((id) => id !== out.id);
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
  expect(button('바이인').getAttribute('aria-disabled')).toBe('true');
});

// 이름 없이 바이인을 누르면 이름 칸 아래에 안내하고 그 칸으로 옮긴다
it('asks for a name when buy-in is pressed with the name empty', async () => {
  const { onSubmit } = await show(fixtureState(3));
  const input = host.querySelector<HTMLInputElement>('input')!;
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button('바이인').click());
  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe('이름을 입력해 주세요.');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toContain(alert!.id);
  expect(document.activeElement).toBe(input);
  expect(onSubmit).not.toHaveBeenCalled();
  await act(() => type(input, 'Zed'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

// 이름 안내가 떠도 도움말 자리를 그대로 차지해 탭을 오가도 창 높이가 바뀌지 않는다
it('keeps the hint in place while the name error shows', async () => {
  await show(eliminated());
  const hint = () => panelAt(0).querySelector('.hint')!;
  await act(async () => button('바이인').click());
  expect(hint().classList.contains('covered')).toBe(true);
  expect(hint().getAttribute('aria-hidden')).toBe('true');
  await act(() => button('재입장').click());
  await act(async () => button('바이인').click());
  // 재입장 탭에서 누른 것은 숨은 새 플레이어 탭의 이름 칸을 바꾸지 않는다
  expect(panelAt(0).querySelector('.field-error')).toBeNull();
  expect(hint().classList.contains('covered')).toBe(false);
});

// 탭 내용 하나를 순서로 찾는다
function panelAt(index: number) {
  return host.querySelectorAll<HTMLElement>('.buy-in-panels > *')[index];
}

// 재입장할 사람을 고르지 않고 바이인을 누르면 목록 위에 안내한다
it('asks to choose someone when re-entry is pressed with nobody chosen', async () => {
  const { onSubmit } = await show(eliminated());
  await act(() => button('재입장').click());
  await act(async () => button('바이인').click());
  expect(activePanel().querySelector('[role="alert"]')?.textContent).toBe(
    '재입장할 탈락자를 골라 주세요.',
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

// 지금 보이는 탭 내용을 찾는다
function activePanel() {
  return host.querySelector<HTMLElement>('.buy-in-panels > :not(.inactive)')!;
}

// 재입장은 자리를 묻지 않고 원래 자리로 보낸다
it('re-enters into the original seat without asking for a seat', async () => {
  const { onSubmit } = await show(eliminated());
  await act(() => button('재입장').click());
  await act(() => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  expect(activePanel().querySelector('select')).toBeNull();
  expect(activePanel().textContent).toContain('원래 자리로 돌아갑니다.');
  await act(async () => button('바이인').click());
  expect(onSubmit).toHaveBeenCalledWith({
    type: 'BUY_IN',
    placement: { kind: 'replace', playerId: 'p1' },
    reentryOf: 'p1',
  });
});

// 원래 자리를 다른 플레이어가 차지했으면 그때만 자리를 고르게 한다
it('asks for a seat when the original seat is taken', async () => {
  const s = apply(eliminated(), {
    type: 'BUY_IN',
    name: 'Zed',
    placement: { kind: 'replace', playerId: 'p1' },
  });
  const { onSubmit } = await show(s);
  await act(() => button('재입장').click());
  await act(() => host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  expect(activePanel().textContent).toContain(
    '원래 자리에 다른 플레이어가 앉아 있습니다. 앉을 자리를 골라 주세요.',
  );
  const select = activePanel().querySelector<HTMLSelectElement>('select')!;
  expect(select).not.toBeNull();
  await act(async () => button('바이인').click());
  expect(onSubmit).toHaveBeenCalledWith({
    type: 'BUY_IN',
    placement: seatOptions(s)[0].placement,
    reentryOf: 'p1',
  });
});

// 두 탭 내용을 함께 두고 안 보이는 쪽만 숨겨 창 높이가 바뀌지 않게 한다
it('keeps both tab contents mounted so the dialog height stays', async () => {
  await show(eliminated());
  const panels = [...host.querySelectorAll<HTMLElement>('.buy-in-panels > *')];
  expect(panels).toHaveLength(2);
  expect(panels[1].getAttribute('aria-hidden')).toBe('true');
  await act(() => button('재입장').click());
  expect(panels[0].getAttribute('aria-hidden')).toBe('true');
  expect(panels[1].getAttribute('aria-hidden')).toBeNull();
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
