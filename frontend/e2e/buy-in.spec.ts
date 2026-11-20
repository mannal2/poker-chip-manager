import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

const idle = (page: Page) => expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');

// 2명 게임을 시작하고 첫 핸드 프리플랍까지 진행한다
async function start(page: Page) {
  await page.goto('/local/');
  await openLocal(page);
  await page.locator('.seat .card-values').first().click();
  await idle(page);
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await idle(page);
}

test('바이인한 플레이어는 다음 핸드부터 시작 칩으로 참여하고 기록에 남는다', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await expect(page.locator('.menu-actions button')).toHaveText(['홈', '바이인', '새 토너먼트']);
  await page.getByRole('button', { name: '바이인', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '바이인' });
  await dialog.getByRole('textbox').fill('Carol');
  await dialog.getByRole('combobox', { name: '자리' }).selectOption({ label: 'P1·P2 사이' });
  await dialog.getByRole('button', { name: '바이인', exact: true }).click();
  await expect(
    page.getByText('Carol 바이인을 마쳤습니다. 바이인 전 행동은 취소할 수 없습니다.'),
  ).toBeVisible();
  await idle(page);

  const carol = page.locator('.seat', { hasText: 'Carol' });
  await expect(carol).toHaveAttribute('aria-label', /다음 핸드부터/);

  await page.getByRole('button', { name: '폴드', exact: true }).click();
  await idle(page);
  await expect(page.locator('.seat')).toHaveCount(3);
  // 헤즈업 버튼(P1) 뒤에 앉은 Carol은 다음 핸드에 버튼을 받고 블라인드 없이 카드를 받는다
  await expect(page.locator('.seat').nth(1)).toContainText('Carol');
  await expect(carol).not.toHaveAttribute('aria-label', /다음 핸드부터|버튼 대기|폴드/);
  await expect(carol.locator('.badge')).toHaveText('D');
  await expect(carol.locator('.stack')).toHaveText('1,000');
  const p1 = page.locator('.seat', { hasText: 'P1' });
  const p2 = page.locator('.seat', { hasText: 'P2' });
  await expect(p2.locator('.badge')).toHaveText('SB');
  await expect(p2.locator('.stack')).toHaveText('1,000');
  await expect(p1.locator('.badge')).toHaveText('BB');
  await expect(p1.locator('.stack')).toHaveText('985');

  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '현재 토너먼트 기록' })).toContainText(
    'Carol - 바이인',
  );
});
