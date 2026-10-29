import { test, expect, type Page } from '@playwright/test';
async function enter(page: Page) {
  await page.goto('/local/');
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
}
async function round(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
}
test('앱 홈은 모드·업데이트, 단일 모드는 자동 생성/복원, 메뉴 두 항목', async ({ page }) => {
  await enter(page);
  await expect(page.getByText('이 화면에서 이어하기', { exact: true })).toHaveCount(0);
  await page.getByLabel('시작 칩', { exact: true }).fill('1500');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await expect(page.locator('.menu-actions button')).toHaveText(['홈', '새 토너먼트']);
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '멀티플레이 모드 · 준비 중', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
  await page.mouse.click(3, 3);
  await page.reload();
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(page.getByLabel('시작 칩', { exact: true })).toHaveValue('1500');
});
test('상단 클릭 기록·예약 표시와 자동 스트리트·다음 핸드 적용', async ({ page }) => {
  await enter(page);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
  await page.getByLabel('다음 SB', { exact: true }).fill('10');
  await page.getByLabel('다음 BB', { exact: true }).fill('20');
  await page.getByRole('button', { name: '예약', exact: true }).click();
  await expect(page.locator('#blinds')).toHaveText('5 / 10 → 10 / 20');
  await expect(page.locator('.pending-blinds')).toHaveCSS('opacity', '0.6');
  for (let street = 0; street < 4; street++) {
    await round(page);
    if (street < 3)
      await expect(page.locator('.board')).toHaveAttribute('data-street', ['FLOP', 'TURN', 'RIVER'][street]);
  }
  await expect(page.getByRole('button', { name: '카드 공개', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '화면 기준 한 자리 회전', exact: true }),
  ).toHaveCount(0);
  await page.locator('.seat').first().click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('#blinds')).toHaveText('10 / 20');
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '현재 토너먼트 기록' })).not.toContainText(
    '블라인드 예약',
  );
  await expect(page.getByRole('dialog', { name: '현재 토너먼트 기록' })).toContainText('획득');
});
test('준비 이름 직접 편집·즉시 D·숫자 중심 정렬·시계 회전', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(3);
  const body = page.locator('.seat .card-values').first();
  await body.click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D', {
    timeout: 450,
  });
  await page.locator('.seat .name').nth(1).click();
  const input = page.getByRole('textbox', { name: 'P2 이름 수정', exact: true });
  await input.fill('직접수정');
  await input.press('Enter');
  await expect(page.locator('.seat .name').nth(1)).toHaveText('직접수정');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  const centers = await page.locator('.count-control,.pot strong').evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return r.y + r.height / 2;
    }),
  );
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  await page.getByRole('button', { name: '화면 기준 한 자리 회전', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  expect(
    await page
      .locator('.seat')
      .first()
      .evaluate((e) => [e.style.left, e.style.top]),
  ).toEqual(['17%', '27%']);
});

test('다른 창이 실제 조작 중일 때만 인수 안내, 자동으로 빼앗지 않음', async ({ page, context }) => {
  await enter(page);
  const other = await context.newPage();
  await other.goto('/local/');
  await other.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(
    other.getByRole('button', { name: '이 창에서 조작하기', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await other.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 화면');
  await expect(other.getByRole('button', { name: '이 창에서 조작하기', exact: true })).toHaveCount(
    0,
  );
});
test('자동 스트리트 저장 실패는 이전 상태 유지·같은 요청 재시도 한 번', async ({ page }) => {
  await enter(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restorePut: () => void }).restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'events') throw new DOMException('용량 부족', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: '체크', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'PREFLOP');
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'FLOP');
  await expect(page.locator('.seat .bet')).toHaveText(['10', '10']);
  await page.reload();
  await page.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await expect(page.locator('.board')).toHaveAttribute('data-street', 'FLOP');
});
test('구형 공개 대기 저장은 지원하지 않는 형식으로 복구 화면을 보여준다', async ({ page }) => {
  await enter(page);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('poker-chip-manager');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('slot', 'readwrite'),
        store = tx.objectStore('slot'),
        r = store.get('current');
      r.onsuccess = () => {
        const saved = r.result;
        Object.assign(saved.state.hand, {
          phase: 'revealPending',
          actorId: null,
          pending: [],
          showdown: false,
        });
        saved.state.undo = null;
        store.put(saved, 'current');
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 토너먼트 시작', exact: true })).toBeVisible();
});

test('리뷰: 이름 입력 중 시작은 초안을 버리지 않고 완료 안내', async ({ page }) => {
  await enter(page);
  await page.locator('.seat .card-values').first().click();
  await page.locator('.seat .name').first().click();
  const input = page.getByRole('textbox', { name: 'P1 이름 수정', exact: true });
  await input.fill('Alice');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(input).toHaveValue('Alice');
  await expect(page.getByRole('status')).toContainText('이름');
  await input.press('Enter');
  await expect(page.locator('.seat .name').first()).toHaveText('Alice');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
});
test('리뷰: 조작권을 잃은 창도 저장 요청 없이 앱 홈·업데이트로 이동', async ({ page, context }) => {
  await enter(page);
  const other = await context.newPage();
  await other.goto('/local/');
  await other.getByRole('button', { name: '단일 기기 모드', exact: true }).click();
  await other.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('다른 화면');
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '앱 업데이트', exact: true }).click();
  await expect(page.getByText('최신 버전을 사용하고 있습니다.', { exact: true })).toBeVisible();
  await expect(other.locator('.seat')).toHaveCount(2);
});
