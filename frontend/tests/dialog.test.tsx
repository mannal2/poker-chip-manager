// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Dialog } from '../src/shared/ui/Dialog';

vi.mock('../src/shared/hooks/useScreenFit', () => ({ useScreenFit: () => {} }));

it('places close before the supplied action in the footer', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {});
  act(() =>
    root.render(
      <Dialog title="확인" onClose={() => {}} actions={<button className="primary">확인</button>}>
        <p>계속할까요?</p>
      </Dialog>,
    ),
  );
  expect(
    [...host.querySelectorAll('.dialog-actions button')].map((button) => button.textContent),
  ).toEqual(['닫기', '확인']);
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
