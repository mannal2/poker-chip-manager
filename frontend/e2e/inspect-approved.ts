import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(pathToFileURL(process.cwd() + '/../prototype/approved-2026-10-18/index.html').href);
await page.screenshot({ path: 'test-results/approved-browser.png' });
console.log(
  await page.locator('.table,.seat,.dock,.meta').evaluateAll((ns) =>
    ns
      .map((n) => ({
        class: n.className,
        rect: n.getBoundingClientRect().toJSON(),
        background: getComputedStyle(n).backgroundColor,
      }))
      .slice(0, 5),
  ),
);
await browser.close();
