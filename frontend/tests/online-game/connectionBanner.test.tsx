// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ConnectionBanner } from '../../src/features/online-game/components/ConnectionBanner';
import type {
  OnlineController,
  OnlineView,
} from '../../src/features/online-game/session/onlineController';

// 밀려난 화면에 안내와 다시 연결 버튼을 보여 주고 누르면 다시 연결한다
it('offers to reconnect a replaced screen', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const reconnect = vi.fn();
  const view = { connection: 'replaced', hasControl: true, pending: false } as OnlineView;
  try {
    await act(() =>
      root.render(
        <ConnectionBanner view={view} controller={{ reconnect } as unknown as OnlineController} />,
      ),
    );
    expect(host.textContent).toContain(
      '다른 화면이 이 자리에 연결되어 이 화면의 연결을 멈췄습니다.',
    );
    expect(host.textContent).not.toContain('재연결 중');
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === '이 화면에서 다시 연결',
    )!;
    await act(() => button.click());
    expect(reconnect).toHaveBeenCalledOnce();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
