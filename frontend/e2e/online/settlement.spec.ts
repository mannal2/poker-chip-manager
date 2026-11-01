import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// 서버가 해당 이름의 차례를 확정한 뒤 버튼을 누른다.
async function action(page: Page, name: string, button: string) {
  await expect(page.locator('.seat.active .name')).toHaveText(name);
  await expect(page.getByRole('button', { name: button, exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await page.getByRole('button', { name: button, exact: true }).click();
}

// 미확정 금액을 실제 칩 버튼으로 입력하여 서버에 제출한다.
async function bet(page: Page, name: string, chips: number[]) {
  await expect(page.locator('.seat.active .name')).toHaveText(name);
  for (const chip of chips)
    await page.getByRole('button', { name: `${chip}칩 추가`, exact: true }).click();
  await action(page, name, 'BET');
}

// 세 명의 실제 칩 차이로 사이드 팟을 만들고 단독 자격 팟과 공유 탐색을 확인한다.
test('shares side-pot navigation and automatically selects the sole eligible winner', async ({
  page,
  browser,
}) => {
  // 세 화면에서 두 핸드를 순차 진행하므로 전체 시나리오의 실행 시간을 확보한다.
  test.slow();
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  const code = await page.getByTestId('room-code').textContent();
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const [bob, carol] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [guest, name] of [
      [bob, 'Bob'],
      [carol, 'Carol'],
    ] as const) {
      await guest.goto(`/online/?code=${code}`);
      await guest.getByLabel('이름', { exact: true }).fill(name);
      await guest.getByRole('button', { name: '방 참가', exact: true }).click();
      await expect(
        guest.getByRole('button', { name: `${name} 이름 수정`, exact: true }),
      ).toBeEnabled();
    }
    await expect(page.locator('.seat')).toHaveCount(3);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.locator('.seat .card-values').first().click();
    await expect(page.locator('.seat').first().locator('.badge')).toHaveText('D');
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await bet(page, 'Alice', [50, 10, 10]);
    await action(bob, 'Bob', '콜 60');
    await action(carol, 'Carol', '폴드');
    for (let street = 0; street < 3; street++) {
      await action(bob, 'Bob', '체크');
      await action(page, 'Alice', '체크');
    }
    await expect(page.locator('.settlement-controls')).toBeVisible();
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Alice' }) })
      .click();
    await expect(bob.locator('.seat.selected .name')).toHaveText('Alice');
    await page.getByRole('button', { name: 'WIN', exact: true }).click();
    await expect(page.locator('.seat .stack')).toHaveText(['1,070', '930', '970']);
    await action(bob, 'Bob', '올인');
    await action(bob, 'Bob', 'BET');
    await action(carol, 'Carol', '콜 920');
    await action(page, 'Alice', '콜 910');
    await bet(carol, 'Carol', [10, 10]);
    await bet(page, 'Alice', [10, 10, 10, 10]);
    await action(carol, 'Carol', '폴드');
    await expect(page.locator('.pot strong')).toHaveText('2,790');
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Bob' }) })
      .click();
    await expect(bob.locator('.seat.selected .name')).toHaveText('Bob');
    await page.getByRole('button', { name: '다음 팟', exact: true }).click();
    for (const current of [page, bob, carol]) {
      await expect(current.locator('.pot strong')).toHaveText('40');
      await expect(current.locator('.pot')).toContainText('2/2');
      await expect(current.locator('.seat.selected .name')).toHaveText('Alice');
    }
    await bob.getByRole('button', { name: '이전 팟', exact: true }).click();
    await expect(bob.locator('.pot strong')).toHaveText('40');
    await page.reload();
    await expect(page.locator('.pot')).toContainText('2/2');
    await expect(page.locator('.seat.selected .name')).toHaveText('Alice');
    await page.getByRole('button', { name: '이전 팟', exact: true }).click();
    await expect(page.locator('.seat.selected .name')).toHaveText('Bob');
  } finally {
    for (const context of contexts) await context.close();
  }
});

// 실제 두 브라우저 화면에서 정산 선택과 새로고침 및 취소 알림을 확인한다.
test('shares winners, restores host picks, confirms WIN and clears picks on undo', async ({
  page,
  browser,
}) => {
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  const code = await page.getByTestId('room-code').textContent();
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(`/online/?code=${code}`);
    await guest.getByLabel('이름', { exact: true }).fill('Bob');
    await guest.getByRole('button', { name: '방 참가', exact: true }).click();
    await expect(page.locator('.seat')).toHaveCount(2);
    await expect(page.locator('.seat .disconnected')).toHaveCount(0);
    await page.locator('.seat .card-values').first().click();
    await page.getByRole('button', { name: '게임 시작', exact: true }).click();
    await expect(page.locator('.seat.active .name')).toHaveText('Alice');
    // 원격 칩 이동은 실제 DOM 생성 이력을 관찰하여 짧은 애니메이션도 놓치지 않는다.
    await guest.evaluate(() => {
      document.body.dataset.flights = '0';
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof Element && node.matches('.chip-flight'))
              document.body.dataset.flights = String(Number(document.body.dataset.flights) + 1);
      }).observe(document.body, { childList: true });
    });
    await page.getByRole('button', { name: '콜 10', exact: true }).click();
    await expect(guest.locator('body')).not.toHaveAttribute('data-flights', '0');
    await guest.getByRole('button', { name: '체크', exact: true }).click();
    for (let street = 0; street < 3; street++) {
      await expect(guest.locator('.seat.active .name')).toHaveText('Bob');
      await guest.getByRole('button', { name: '체크', exact: true }).click();
      await expect(page.locator('.seat.active .name')).toHaveText('Alice');
      await page.getByRole('button', { name: '체크', exact: true }).click();
    }
    await expect(guest.locator('.dock-notice')).toHaveText(
      '방장이 승자를 선택하고 있습니다 · 0명 선택',
    );
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Alice' }) })
      .click();
    await expect(guest.locator('.seat.selected .name')).toHaveText('Alice');
    await page.reload();
    await expect(page.locator('.seat.selected .name')).toHaveText('Alice');
    await guest.getByRole('button', { name: '취소', exact: true }).dispatchEvent('click');
    await expect(guest.locator('.toast')).toHaveText('방장만 취소할 수 있습니다');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(current.locator('.seat.selected')).toHaveCount(0);
      await expect(current.locator('.toast')).toHaveText(
        current === page ? '방장이 직전 행동을 취소했습니다' : '방장이 Alice의 체크를 취소했습니다',
      );
    }
    await page.getByRole('button', { name: '체크', exact: true }).click();
    await page
      .locator('.seat')
      .filter({ has: page.locator('.name', { hasText: 'Alice' }) })
      .click();
    await page.getByRole('button', { name: 'WIN', exact: true }).click();
    for (const current of [page, guest]) {
      await expect(
        current.getByRole('button', { name: '현재 토너먼트 기록', exact: true }),
      ).toContainText('02');
      await expect(current.locator('.pot strong')).toHaveText('30');
    }
  } finally {
    await context.close();
  }
});
