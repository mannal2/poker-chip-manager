// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '../../src/app/mount';

// 시험이 만든 루트를 정리한다
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

// 모든 페이지는 화면 맨 위에 터치를 받지 않는 상단 띠를 함께 그린다
it('paints a top edge strip that never takes a touch on every page', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';

  await act(async () => mount(<main>page</main>));

  const strip = document.querySelector('.top-edge');
  expect(strip).not.toBeNull();
  expect(strip?.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('main')?.textContent).toBe('page');
});
