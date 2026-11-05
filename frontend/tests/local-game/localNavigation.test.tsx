// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useLocalNavigation } from '../../src/features/local-game/hooks/useLocalNavigation';

it('restores the game history when leaving is blocked and uses the latest guard', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history.replaceState(null, '', '/local/');
  const element = document.createElement('div');
  const root = createRoot(element);
  const enter = vi.fn(async () => {});
  const blocked = vi.fn(() => false);
  const allowed = vi.fn(() => true);
  function Harness({ leave }: { leave: () => boolean }) {
    useLocalNavigation(false, enter, leave);
    return null;
  }
  try {
    await act(() => root.render(<Harness leave={blocked} />));
    const pop = async () =>
      act(() => {
        history.replaceState(null, '', '/local/');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
    await pop();
    expect(blocked).toHaveBeenCalledOnce();
    expect(history.state.localGameScreen).toBe(true);
    await act(() => root.render(<Harness leave={allowed} />));
    await pop();
    expect(allowed).toHaveBeenCalledOnce();
    expect(history.state).toBeNull();
    expect(enter).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
