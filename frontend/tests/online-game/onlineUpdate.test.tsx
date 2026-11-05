// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useOnlineUpdate } from '../../src/features/online-game/hooks/useOnlineUpdate';

const html = (css = 'old') =>
  `<script type="module" src="/assets/online-old.js"></script><link rel="stylesheet" href="/assets/${css}.css">`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('detects a CSS-only update on the next minute and revalidates HTML', async () => {
  const x = await mount();
  try {
    expect(x.node.textContent).toBe('current');
    x.fetch.mockResolvedValue(new Response(html('new')));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(x.node.textContent).toBe('update');
    expect(x.fetch).toHaveBeenCalledWith(
      '/online/',
      expect.objectContaining({ cache: 'no-cache' }),
    );
  } finally {
    await x.close();
  }
});

it('ignores failed or invalid responses and checks again when the page returns', async () => {
  const x = await mount();
  try {
    x.fetch.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(x.node.textContent).toBe('current');
    x.fetch.mockResolvedValue(new Response('<html>error</html>'));
    await act(() => window.dispatchEvent(new Event('focus')));
    expect(x.node.textContent).toBe('current');
    x.fetch.mockResolvedValue(new Response(html('new')));
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(x.node.textContent).toBe('update');
  } finally {
    await x.close();
  }
});

it('does not check while hidden and cancels an in-flight check on unmount', async () => {
  const x = await mount();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(x.fetch).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  x.fetch.mockReturnValue(new Promise(() => {}));
  await act(() => window.dispatchEvent(new Event('pageshow')));
  const options = x.fetch.mock.lastCall![1] as RequestInit;
  await x.close();
  expect(options.signal?.aborted).toBe(true);
});

async function mount() {
  (
    window as unknown as import('happy-dom').Window
  ).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const assets = document.createElement('div');
  assets.innerHTML = html();
  document.head.append(assets);
  const node = document.createElement('div');
  const root = createRoot(node);
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async () => new Response(html()),
  );
  vi.stubGlobal('fetch', fetch);
  function Harness() {
    return <>{useOnlineUpdate() ? 'update' : 'current'}</>;
  }
  await act(() => root.render(<Harness />));
  return {
    node,
    fetch,
    close: async () => {
      await act(() => root.unmount());
      assets.remove();
    },
  };
}
