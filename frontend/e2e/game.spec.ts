import { openLocal } from './helpers';
import { test, expect } from '@playwright/test';
async function setup(page: import('@playwright/test').Page, count = 6) {
  await page.goto('/local/');
  await openLocal(page);
  await expect(page.getByRole('button', { name: '게임 시작', exact: true })).toBeVisible();
  for (let i = 2; i < count; i++) {
    await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
    await expect(page.locator('.seat')).toHaveCount(i + 1);
  }
  await page.locator('.seat .card-values').last().click();
  await expect(page.locator('.seat').last().locator('.badge')).toContainText('D');
}
test('A05 준비 설정 자동 저장·유효값 복원·시작 1회', async ({ page }) => {
  await setup(page);
  await page.getByLabel('시작 칩', { exact: true }).fill('1500');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  await page.getByLabel('시작 칩', { exact: true }).fill('7');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await openLocal(page);
  await expect(page.getByLabel('시작 칩', { exact: true })).toHaveValue('1500');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
  await expect(page.locator('.pot strong')).toHaveText('15');
  await expect(page.locator('.meta')).toContainText('01');
});
test('A05 이름·인원·첫D 직접 설정', async ({ page }) => {
  await setup(page, 9);
  await page.locator('.seat .name').first().click();
  await page
    .getByRole('textbox', { name: 'P1 이름 수정', exact: true })
    .fill('가나다라마바사아자차');
  await page.getByRole('textbox', { name: 'P1 이름 수정', exact: true }).press('Enter');
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat')).toHaveCount(9);
  await expect(page.locator('.seat').first()).toContainText('가나다라마바사아자차');
  await expect(page.locator('.seat').first().locator('.badge')).toHaveText('D');
});

test('A05 드래그 삽입 이동과 영역밖 취소', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const cards = page.locator('.seat');
  const initial = await cards.locator('.name').allTextContents();
  await cards.nth(0).locator('.card-values').hover();
  const a = (await cards.nth(0).locator('.card-values').boundingBox())!,
    b = (await cards.nth(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(cards.nth(2).locator('.name')).toHaveText(initial[0]);
  expect(await cards.locator('.name').allTextContents()).toEqual([
    initial[1],
    initial[2],
    initial[0],
    ...initial.slice(3),
  ]);
  const c = (await cards.nth(0).locator('.card-values').boundingBox())!;
  const after = await cards.locator('.name').allTextContents();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(0, 800);
  await page.mouse.up();
  expect(await cards.locator('.name').allTextContents()).toEqual(after);
});
async function start(page: import('@playwright/test').Page) {
  await setup(page);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
}
test('A06 칩 초안·C·BET 추가액만 차감, CALL은 초안 무시', async ({ page }) => {
  await start(page);
  const actor = page.locator('.seat.active');
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  await expect(actor.locator('.bet')).toHaveText('60');
  await expect(actor.locator('.stack')).toHaveText('1,000');
  await page.getByRole('button', { name: '미확정 입력 초기화' }).click();
  await expect(actor.locator('.bet')).toHaveText('0');
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  const id = await actor.getAttribute('data-player');
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator(`[data-player="${id}"] .stack`)).toHaveText('940');
  await expect(page.locator(`[data-player="${id}"] .bet`)).toHaveText('60');
  await page.getByRole('button', { name: '100칩 추가', exact: true }).click();
  const next = await actor.getAttribute('data-player');
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.locator(`[data-player="${next}"] .bet`)).toHaveText('60');
  await page.getByRole('button', { name: '무르기', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('0');
});
test('A06 저장 실패: 확정잔액 보존·재시도1회', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  const id = await page.locator('.seat.active').getAttribute('data-player');
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
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator(`[data-player="${id}"] .stack`)).toHaveText('1,000');
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator(`[data-player="${id}"] .stack`)).toHaveText('950');
  await expect(page.locator('.pot strong')).toHaveText('65');
});
async function actRound(page: import('@playwright/test').Page, n = 6) {
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: /^(콜 [\d,]+|체크)$/ }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
}
test('A07 모든 스트리트·H20+60=80・WIN 다음 핸드', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await actRound(page, 5);
  await expect(page.getByRole('button', { name: '무르기', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await expect(page.locator('.seat.active .bet')).toHaveText('20');
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('80');
  await expect(page.locator('.seat.active .stack')).toHaveText('980');
  await page.getByRole('button', { name: '미확정 입력 초기화' }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('20');
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await page.getByRole('button', { name: '10칩 추가', exact: true }).click();
  const actor = await page.locator('.seat.active').getAttribute('data-player');
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator(`[data-player="${actor}"] .stack`)).toHaveText('920');
  await actRound(page, 5);
  await actRound(page);
  await actRound(page);
  await expect(page.locator('.settlement-count')).toHaveText('0명 선택');
  await page.locator('.seat').nth(0).click();
  await page.locator('.seat').nth(1).click();
  await expect(page.locator('.settlement-count')).toHaveText('2명 선택');
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.meta')).toContainText('02');
  await expect(page.locator('.pot strong')).toHaveText('15');
});
test('A07 HU 올인 runout·정산 저장 실패·최종 우승', async ({ page }) => {
  await setup(page, 2);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await page.getByRole('button', { name: /^콜 / }).click();
  await expect(page.getByRole('button', { name: 'WIN', exact: true })).toBeVisible();
  await page.locator('.seat').first().click();
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
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.seat .stack').first()).toHaveText('0');
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('토너먼트 종료');
  await expect(page.locator('.seat .stack').first()).toHaveText('2,000');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.summary')).toContainText('토너먼트 종료');
});
test('A07 side pot 모순 거절·초안 새로고침 폐기·동률', async ({ page }) => {
  await setup(page, 3);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  for (let street = 0; street < 4; street++) {
    await actRound(page, 3);
  }
  await expect(page.getByRole('button', { name: 'WIN', exact: true })).toBeVisible();
  await page.locator('.seat').nth(0).click();
  await page.locator('.seat').nth(1).click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.meta')).toContainText('02');
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await actRound(page, 2);
  await expect(page.locator('.pot strong')).toHaveText('2,970');
  await page.locator('.seat').nth(0).click();
  await page.getByRole('button', { name: '다음 팟', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('.pot strong')).toHaveText('30');
  await page.locator('.seat').nth(1).click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('충돌');
  await expect(page.locator('.meta')).toContainText('02');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.settlement-count')).toHaveText('0명 선택');
  await page.locator('.seat').nth(2).click();
  await page.getByRole('button', { name: '다음 팟', exact: true }).click({ timeout: 5000 });
  await page.locator('.seat').nth(1).click();
  await page.getByRole('button', { name: 'WIN', exact: true }).click();
  await expect(page.locator('.meta')).toContainText('03');
  await expect(page.locator('.seat').nth(0)).toHaveAttribute('aria-label', /탈락/);
});
test('A10 준비 IME 미확정·저장 실패·재시도', async ({ page }) => {
  await setup(page);
  await page.locator('.seat .name').first().click();
  const name = page.getByRole('textbox', { name: 'P1 이름 수정', exact: true });
  await name.dispatchEvent('compositionstart');
  await name.fill('ㅎ');
  await name.press('Enter');
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.seat .name').first()).toHaveText('P1');
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
  await page.getByLabel('시작 칩', { exact: true }).fill('1500');
  await page.getByLabel('SB', { exact: true }).focus();
  await expect(page.getByRole('alert')).toContainText('재시도');
  await expect(page.locator('.seat .stack').first()).toHaveText('1,000');
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
});
test('A10 드래그 도중 다른 탭 인수는 초안 취소·이전 화면 차단', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const before = await page.locator('.seat .name').allTextContents(),
    a = (await page.locator('.seat').first().locator('.card-values').boundingBox())!,
    b = (await page.locator('.seat').nth(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await expect(page.getByRole('alert')).toContainText('다른 화면');
  await page.mouse.up();
  expect(await page.locator('.seat .name').allTextContents()).toEqual(before);
  expect(await other.locator('.seat .name').allTextContents()).toEqual(before);
  await other.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(other.locator('.seat.active')).toHaveCount(1);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: /^콜 / }).dispatchEvent('click');
  await expect(other.locator('.pot strong')).toHaveText('15');
});
test('A10 올인·폴드 상태는 역할과 함께 카드에서 구분한다', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '올인', exact: true }).click();
  await page.getByRole('button', { name: 'BET', exact: true }).click();
  await expect(page.locator('.seat').nth(2).locator('.badge')).toContainText('올인');
  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await expect(page.locator('.seat').nth(3).locator('.badge')).toContainText('폴드');
});
test('A10 다른 탭의 새 게임을 삭제 확인 없이 교체하지 않는다', async ({ page, context }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined }),
  );
  await setup(page, 2);
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await other.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  other.once('dialog', (d) => d.accept());
  await other.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await other.locator('.seat .card-values').first().click();
  await other.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(other.locator('.pot strong')).toHaveText('15');
  let confirmations = 0;
  page.on('dialog', async (d) => {
    confirmations++;
    if (confirmations === 1) await d.accept();
    else await d.dismiss();
  });
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '새 토너먼트', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  expect(confirmations).toBe(2);
  await other.reload();
  await openLocal(other);
  await expect(other.locator('.pot strong')).toHaveText('15');
});

test('리뷰 회귀: 인수 후 베팅 초안은 재등장하지 않는다', async ({ page, context }) => {
  await start(page);
  await page.getByRole('button', { name: '50칩 추가', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('50');
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await expect(page.getByRole('alert')).toContainText('다른 화면');
  await expect(page.locator('.seat.active .bet')).toHaveText('0');
  await page.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.locator('.seat.active .bet')).toHaveText('0');
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await openLocal(page);
  await expect(page.locator('.seat.active .bet')).toHaveText('0');
});
test('리뷰 회귀: 다른 탭의 준비 설정을 인수한 뒤 옛 입력으로 덮지 않는다', async ({
  page,
  context,
}) => {
  await setup(page);
  const other = await context.newPage();
  await other.goto('/local/');
  await openLocal(other);
  await other.getByLabel('시작 칩', { exact: true }).fill('1500');
  await other.getByLabel('SB', { exact: true }).focus();
  await expect(other.locator('.seat .stack').first()).toHaveText('1,500');
  await page.getByRole('button', { name: '이 창에서 조작하기', exact: true }).click();
  await expect(page.locator('.seat .stack').first()).toHaveText('1,500');
  await expect(page.getByLabel('시작 칩', { exact: true })).toHaveValue('1500');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat').nth(2).locator('.stack')).toHaveText('1,500');
});
test('리뷰 회귀: 빈 SB 위치는 SB 없음으로 표시한다', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('poker-chip-manager', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(['slot'], 'readwrite'),
          get = tx.objectStore('slot').get('current');
        get.onsuccess = () => {
          const saved = get.result,
            s = saved.state;
          s.status = 'playing';
          s.version = 1;
          s.pot = 10;
          s.undo = null;
          s.players.forEach(
            (
              p: {
                id: string;
                stack: number;
                eliminated: boolean;
                folded: boolean;
                B: number;
                H: number;
                actedAt: null;
                reopenAt: number;
              },
              i: number,
            ) => {
              p.stack = [1990, 1000, 0, 1000, 1000, 1000][i];
              p.eliminated = i === 2;
              p.folded = false;
              p.B = i === 3 ? 10 : 0;
              p.H = p.B;
              p.actedAt = null;
              p.reopenAt = 0;
            },
          );
          s.hand = {
            id: 'empty-sb-fixture',
            number: 2,
            street: 0,
            phase: 'betting',
            buttonSeat: 1,
            sbSeat: 2,
            bbSeat: 3,
            sb: 5,
            bb: 10,
            actorId: s.players[4].id,
            W: 10,
            R: 10,
            pending: s.players
              .filter((_: unknown, i: number) => i !== 2)
              .map((p: { id: string }) => p.id),
            showdown: false,
          };
          tx.objectStore('slot').put(saved, 'current');
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await openLocal(page);
  await expect(page.locator('.pot span')).toContainText('SB 없음');
  await expect(page.locator('[data-player="p1"] .badge')).toContainText('D');
  await expect(page.locator('.seat').nth(3).locator('.badge')).toContainText('BB');
});
