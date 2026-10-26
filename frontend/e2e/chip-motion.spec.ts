import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';
async function start(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const a = original.call(this, frames, options);
      if (this.matches('.chip-flight')) a.pause();
      return a;
    };
  });
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await idle(page);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await idle(page);
}
const idle = (page: Page) => expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');

test('저장 재시도 전에 화면 크기가 바뀌면 이전 좌표 효과를 재생하지 않음', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('test', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await idle(page);
  await expect(page.locator('.seat .stack')).toHaveText(['990', '990']);
  await expect(page.locator('.pot strong')).toHaveText('20');
  await expect(page.locator('.chip-flight')).toHaveCount(0);
});
test('초안은 이동 없음, 납부는 카드에서 팟, 취소·회전·복원은 효과 정리', async ({ page }) => {
  await start(page);
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  const actor = await page.locator('.seat.active').getAttribute('data-player');
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await idle(page);
  const flight = page.locator('.chip-flight');
  await expect(flight).toHaveCount(1);
  await expect(flight).toHaveAttribute('data-from', actor!);
  await expect(flight).toHaveAttribute('data-to', 'pot');
  expect(await flight.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  const target = (await page.locator('.pot strong').boundingBox())!;
  const end = await flight.evaluate(
    (e) =>
      (e.getAnimations()[0].effect as KeyframeEffect).getKeyframes().at(-1)!.transform as string,
  );
  expect(end).toContain('translate');
  expect(await flight.evaluate((e) => e.getAnimations()[0].effect!.getTiming().duration)).toBe(720);
  expect(target.width).toBeGreaterThan(0);
  const destination = await flight.evaluate((e) => {
    e.getAnimations()[0].currentTime = 719.99;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(destination.x).toBeCloseTo(target.x + target.width / 2, 0);
  expect(destination.y).toBeCloseTo(target.y + target.height / 2, 0);

  await page.getByRole('button', { name: '취소', exact: true }).click();
  await idle(page);
  await expect(flight).toHaveCount(0);
  await page.getByRole('button', { name: /^콜 / }).click();
  await idle(page);
  await expect(flight).toHaveCount(1);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(flight).toHaveCount(0);
  await page.reload();
  await openLocal(page);
  await expect(flight).toHaveCount(0);
});
test('공동 WIN은 팟에서 수령자 모두에게 동시에, 선택 중에는 이동 없음', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await idle(page);
  await page.getByRole('button', { name: /^콜 / }).click();
  await idle(page);
  const before = await page.locator('.chip-flight').count();
  await page.locator('.seat').first().click();
  await page.locator('.seat').last().click();
  await expect(page.locator('.chip-flight')).toHaveCount(before);
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await idle(page);
  const payouts = page.locator('.chip-flight[data-kind="payout"]');
  await expect(payouts).toHaveCount(2);
  expect(
    await payouts.evaluateAll((es) =>
      es.map((e) => ({
        to: (e as HTMLElement).dataset.to,
        amount: (e as HTMLElement).dataset.amount,
        delay: e.getAnimations()[0].effect!.getTiming().delay,
      })),
    ),
  ).toEqual([
    { to: 'p0', amount: '1000', delay: 0 },
    { to: 'p1', amount: '1000', delay: 0 },
  ]);
});
test('저장 실패에는 효과 없음, 같은 요청 재시도 성공에서 한 번, 동작 줄이기는 생략', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const old = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = old;
    };
    IDBObjectStore.prototype.put = function (...a) {
      if (this.name === 'events') throw new DOMException('test', 'QuotaExceededError');
      return old.apply(this, a);
    };
  });
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await idle(page);
  await expect(page.locator('.chip-flight')).toHaveCount(1);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await idle(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /^콜 / }).click();
  await idle(page);
  await expect(page.locator('.chip-flight')).toHaveCount(0);
});

test('폴드 반환과 지급은 한 번, 획득 알림 없이 자동 진행·효과 정리', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await idle(page);
  const payouts = page.locator('.chip-flight[data-kind="payout"]');
  await expect(page.locator('.chip-flight')).toHaveCount(1);
  await expect(payouts).toHaveAttribute('data-amount', '15');
  await expect(payouts).toHaveAttribute('data-to', 'p1');
  expect(await payouts.evaluate((e) => e.getAnimations()[0].effect!.getTiming().delay)).toBe(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  await page
    .locator('.chip-flight')
    .evaluateAll((es) => es.forEach((e) => e.getAnimations().forEach((a) => a.finish())));
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await page.getByRole('button', { name: /^콜 / }).click();
  await idle(page);
  await expect(page.locator('.chip-flight')).toHaveCount(1);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await expect(page.locator('.chip-flight')).toHaveCount(0);
});

test('폴드 자동 정산에는 획득 알림이 없다', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { foldToasts: string[] }).foldToasts = seen;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element)
            for (const toast of [
              ...(node.matches('.toast') ? [node] : []),
              ...node.querySelectorAll('.toast'),
            ])
              seen.push(toast.textContent ?? '');
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await idle(page);
  await expect(page.getByLabel('현재 토너먼트 기록', { exact: true })).toContainText('02');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(
    await page.evaluate(() => (window as unknown as { foldToasts: string[] }).foldToasts),
  ).toEqual([]);
});

test('폴드 저장 재시도도 단일 이동, 반환·지급 기록과 취소 복원 유지', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const old = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = old;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('test', 'QuotaExceededError');
      return old.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await idle(page);
  await expect(page.locator('.chip-flight')).toHaveCount(1);
  await expect(page.locator('.chip-flight')).toHaveAttribute('data-amount', '15');
  await page.getByLabel('현재 토너먼트 기록', { exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('미콜 5칩 반환');
  await expect(page.locator('.history-list')).toContainText('10칩 획득');
  await page.mouse.click(3, 3);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await idle(page);
  await expect(page.getByLabel('현재 토너먼트 기록', { exact: true })).toContainText('01');
  await expect(page.locator('.chip-flight')).toHaveCount(0);
  await expect(page.locator('.seat .stack')).toHaveText(['995', '990']);
});
