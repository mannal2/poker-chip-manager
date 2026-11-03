import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// 실제 화면에서 방을 생성하고 초대 코드를 반환한다
export async function createRoom(page: Page) {
  await page.goto('/online/');
  await page.getByLabel('이름', { exact: true }).fill('Alice');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  return (await page.getByTestId('room-code').textContent())!;
}

// 독립 세션 화면을 같은 방에 참가시킨다
export async function joinRoom(page: Page, code: string, name = 'Bob') {
  await page.goto(`/online/?code=${code}`);
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect(page.locator('.seat')).toHaveCount(2);
}

// 모든 연결이 확정된 방에서 첫 번째 좌석을 딜러로 지정하고 시작한다
export async function startRoom(page: Page, count = 2) {
  await expect(page.locator('.seat')).toHaveCount(count);
  await expect(page.locator('.seat .disconnected')).toHaveCount(0);
  await page.locator('.seat .card-values').first().click();
  await expect(page.locator('.seat').first().locator('.badge')).toContainText('D');
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.locator('.seat.active')).toHaveCount(1);
}

// 관리 메뉴 항목을 누르고 필요한 참가자 대상을 지정한다
export async function menu(page: Page, label: string, target?: string) {
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  if (target)
    await page
      .getByRole('group', { name: `${label} 대상` })
      .getByRole('button', { name: target, exact: true })
      .click();
}

// 공통 확인 대화상자에서 관리 명령을 확정한다
export async function confirm(page: Page, title: string) {
  await page
    .getByRole('dialog', { name: title, exact: true })
    .getByRole('button', { name: '확인', exact: true })
    .click();
}
