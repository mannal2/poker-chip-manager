// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tabs } from '../../src/shared/ui/Tabs';

const TABS = [
  { id: 'a', label: '첫째' },
  { id: 'b', label: '둘째' },
] as const;
let host: HTMLDivElement;
let root: Root;
// 선택 상태를 들고 있는 시험용 탭 묶음을 그린다
function Harness({ disabled }: { disabled?: boolean }) {
  const [selected, setSelected] = useState<'a' | 'b'>('a');
  return (
    <Tabs
      tabs={TABS}
      selected={selected}
      onSelect={setSelected}
      disabled={disabled}
      label="시험"
      idPrefix="t"
    />
  );
}
// 탭 버튼을 id로 찾는다
const tab = (id: string) => host.querySelector<HTMLButtonElement>(`#t-tab-${id}`)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('renders tabs with roving focus', () => {
  act(() => root.render(<Harness />));
  const list = host.querySelector('[role="tablist"]')!;
  expect(list.getAttribute('aria-label')).toBe('시험');
  expect(tab('a').getAttribute('role')).toBe('tab');
  expect(tab('a').getAttribute('aria-selected')).toBe('true');
  expect(tab('b').getAttribute('aria-selected')).toBe('false');
  expect(tab('a').tabIndex).toBe(0);
  expect(tab('b').tabIndex).toBe(-1);
  expect(tab('a').getAttribute('aria-controls')).toBe('t-panel');
});

it('moves with arrow keys', () => {
  act(() => root.render(<Harness />));
  tab('a').focus();
  act(() => {
    tab('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(tab('b').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tab('b'));
  act(() => {
    tab('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  expect(tab('a').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tab('a'));
});

it('disables every tab', () => {
  act(() => root.render(<Harness disabled />));
  expect(tab('a').disabled).toBe(true);
  expect(tab('b').disabled).toBe(true);
});
