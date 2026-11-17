import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// 설치 앱으로 열릴 수 있는 세 진입 페이지
const pages = ['index.html', 'local/index.html', 'online/index.html'];

// iOS 26.1+ 설치 앱은 내용이 상태 표시줄 뒤에 놓이면 상단에 블러를 그리므로 viewport-fit=cover를 쓰지 않는다
it.each(pages)('%s keeps content out from behind the status bar', (page) => {
  const html = readFileSync(resolve(__dirname, '../..', page), 'utf8');
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? '';
  expect(viewport).toContain('width=device-width');
  expect(viewport).not.toContain('viewport-fit=cover');
  expect(html).toMatch(
    /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"\s*\/?>/,
  );
});
