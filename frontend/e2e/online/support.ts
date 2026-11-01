import type { Browser, Page } from '@playwright/test';

// 새 브라우저 컨텍스트에서 온라인 참가자 화면을 연다.
export async function newParticipant(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4174/online/');
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}
