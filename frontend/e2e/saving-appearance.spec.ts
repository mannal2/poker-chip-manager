import { test, expect } from '@playwright/test';
import { openLocal } from './helpers';

test.use({ hasTouch: true, viewport: { width: 800, height: 1280 } });

for (const screen of ['setup', 'betting']) {
  test(`${screen}: 저장 대기 중 밝기 유지·중복 조작 차단`, async ({ page }) => {
    await page.goto('/local/');
    await openLocal(page);
    if (screen === 'betting') {
      await page.getByRole('textbox', { name: '시작 칩', exact: true }).fill('50');
      await page.getByRole('textbox', { name: '시작 칩', exact: true }).press('Tab');
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
      await page.locator('.seat .card-values').first().click();
      await page.getByRole('button', { name: '게임 시작', exact: true }).click();
      await expect(page.locator('.pot strong')).toHaveText('15');
    }
    const opacity = () =>
      page
        .locator('.setup-fields,.count-control,.view-rotate,.dock button')
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
    const before = await opacity();
    await page.evaluate(() => {
      const original = IDBTransaction.prototype.addEventListener;
      const held: (() => void)[] = [];
      let released = false;
      (window as unknown as { releaseSave: () => void }).releaseSave = () => {
        released = true;
        IDBTransaction.prototype.addEventListener = original;
        held.splice(0).forEach((deliver) => deliver());
      };
      IDBTransaction.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type === 'complete' && this.mode === 'readwrite' && listener) {
          original.call(
            this,
            type,
            (event) => {
              const deliver = () => {
                if (typeof listener === 'function') listener.call(this, event);
                else listener.handleEvent(event);
              };
              if (released) deliver();
              else held.push(deliver);
            },
            options,
          );
        } else original.call(this, type, listener, options);
      };
    });
    const action =
      screen === 'setup'
        ? page.locator('.seat .card-values').first()
        : page.getByRole('button', { name: '콜 5', exact: true });
    await action.tap();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
    expect(await opacity()).toEqual(before);
    if (screen === 'betting') {
      await action.dispatchEvent('click');
      await action.dispatchEvent('click');
      await expect(page.locator('.pot strong')).toHaveText('15');
    } else {
      await page.getByRole('button', { name: '참가자 추가', exact: true }).dispatchEvent('click');
      await expect(page.locator('.seat')).toHaveCount(2);
    }
    await page.evaluate(() => (window as unknown as { releaseSave: () => void }).releaseSave());
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    if (screen === 'betting') {
      await expect(page.locator('.pot strong')).toHaveText('20');
      await page.reload();
      await openLocal(page);
      await expect(page.locator('.pot strong')).toHaveText('20');
      await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
    } else {
      await expect(page.locator('.seat')).toHaveCount(2);
      await expect(page.locator('.badge').first()).toContainText('D');
    }
  });
}
