import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';

async function offer(page: Page, outcome = 'dismissed') {
  await page.evaluate((result) => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installCalls = String(
          Number(document.documentElement.dataset.installCalls || 0) + 1,
        );
      },
      userChoice: Promise.resolve({ outcome: result, platform: 'web' }),
    });
    window.dispatchEvent(event);
    document.documentElement.dataset.installPrevented = String(event.defaultPrevented);
  }, outcome);
}
const popup = (page: Page) =>
  page.getByRole('dialog', { name: '앱으로 설치해서 사용하세요', exact: true });

test('설치 제안: 최초 안내·나중에·수동 재접근·브라우저 취소·재방문', async ({ page }) => {
  await page.goto('/local/');
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await expect(popup(page)).toHaveCount(0);
  await offer(page);
  await expect(popup(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-install-prevented', 'true');
  await popup(page).getByRole('button', { name: '나중에', exact: true }).click();
  await expect(popup(page)).toHaveCount(0);
  await page.getByRole('button', { name: '앱 설치', exact: true }).click();
  await popup(page).getByRole('button', { name: '앱 설치', exact: true }).click();
  await expect(popup(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-install-calls', '1');
  await page.getByRole('button', { name: '앱 설치', exact: true }).click();
  await expect(popup(page)).toContainText('브라우저 메뉴');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await offer(page);
  await expect(page.getByRole('button', { name: '앱 설치', exact: true })).toBeVisible();
  await expect(popup(page)).toHaveCount(0);
});

test('미지원 브라우저는 설치 항목 없이 홈 사용 가능', async ({ page }) => {
  await page.goto('/local/');
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await expect(popup(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '앱 설치', exact: true })).toHaveCount(0);
});

test('설치 선택 대기 중 중복 호출·바깥 닫기 방지', async ({ page }) => {
  await page.goto('/local/');
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installCalls = '1';
      },
      userChoice: new Promise((resolve) => {
        window.addEventListener('choose-install', () => resolve({ outcome: 'dismissed' }), {
          once: true,
        });
      }),
    });
    window.dispatchEvent(event);
  });
  await popup(page).getByRole('button', { name: '앱 설치', exact: true }).click();
  await expect(popup(page).getByRole('button', { name: '나중에', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);
  await expect(popup(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-install-calls', '1');
  await page.evaluate(() => window.dispatchEvent(new Event('choose-install')));
  await expect(popup(page)).toHaveCount(0);
});

test('iPad 데스크톱 UA·설치 기억 저장 불가에서도 게임 진입', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/local/');
  await expect(popup(page)).toContainText('Safari의 공유');
  expect(
    await page.evaluate(() => {
      const box = document.querySelector('dialog')!.getBoundingClientRect();
      return (
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= innerWidth &&
        box.bottom <= innerHeight &&
        document.documentElement.scrollHeight <= innerHeight
      );
    }),
  ).toBe(true);
  await popup(page).getByRole('button', { name: '나중에', exact: true }).click();
  await openLocal(page);
  await expect(page.locator('.seat')).toHaveCount(2);
});

test('게임 중 안내 없음·홈 복귀 후 제안·앱 설치 완료 후 숨김', async ({ page }) => {
  await page.goto('/local/');
  await openLocal(page);
  await offer(page, 'accepted');
  await expect(popup(page)).toHaveCount(0);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole('button', { name: '앱 설치', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(popup(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '앱 설치', exact: true })).toHaveCount(0);
});

test('설치 실패는 메뉴 안내로 복구하고 게임 진입을 유지', async ({ page }) => {
  await page.goto('/local/');
  await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: () => Promise.reject(new Error('unavailable')) });
    window.dispatchEvent(event);
  });
  await popup(page).getByRole('button', { name: '앱 설치', exact: true }).click();
  await expect(popup(page)).toContainText('설치 창을 열지 못했습니다.');
  await expect(popup(page)).toContainText('브라우저 메뉴');
  await page.mouse.click(2, 2);
  await openLocal(page);
  await expect(page.locator('.seat')).toHaveCount(2);
});

test.describe('iPhone 설치 안내', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test('자동 안내·바깥 탭 닫기·재방문 억제·수동 안내', async ({ page }) => {
    await page.goto('/local/');
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toContainText('홈 화면에 추가');
    await expect(popup(page).getByRole('button', { name: '앱 설치', exact: true })).toHaveCount(0);
    await page.mouse.click(2, 2);
    await page.reload();
    await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
    await expect(popup(page)).toHaveCount(0);
    await page.getByRole('button', { name: '앱 설치', exact: true }).click();
    await expect(popup(page)).toBeVisible();
  });
  test('standalone 앱에서는 설치 안내·버튼 없음', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await page.goto('/local/');
    await expect(page.getByRole('button', { name: '단일 기기 모드', exact: true })).toBeEnabled();
    await offer(page);
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '앱 설치', exact: true })).toHaveCount(0);
  });
});
