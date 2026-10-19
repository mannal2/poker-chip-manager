import { test, expect } from '@playwright/test';
for (const width of [320, 360, 390, 430])
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9])
    test(`디자인 ${width}px ${count}명`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      let bounds: unknown;
      for (const phase of ['setup', 'betting', 'reveal', 'settlement']) {
        await page.goto(`/e2e/design.html?n=${count}&phase=${phase}&stress=1`);
        const table = await page.locator('.table').boundingBox();
        if (!bounds) bounds = table;
        else expect(table).toEqual(bounds);
        const cards = await page.locator('.seat').evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
        );
        for (let i = 0; i < cards.length; i++)
          for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i],
              b = cards[j];
            expect(
              a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y,
            ).toBe(true);
          }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page
            .locator('.card-values>div')
            .evaluateAll((ns) => ns.every((n) => n.scrollWidth <= n.clientWidth)),
        ).toBe(true);
      }
    });
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
for (const width of [320, 390])
  for (const count of [2, 6, 9])
    for (const phase of ['setup', 'betting', 'reveal', 'settlement', 'selected'])
      test(`고정 HTML 비교 ${width} ${count} ${phase}`, async ({ page, context }, info) => {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
        const approved = await context.newPage();
        await approved.setViewportSize({ width, height: width === 320 ? 568 : 844 });
        await approved.goto(
          pathToFileURL(resolve('../prototype/approved-2026-10-18/index.html')).href,
        );
        await approved
          .locator(`[data-count="${count}"]`)
          .evaluate((e) => (e as HTMLButtonElement).click());
        await approved
          .locator(
            `[data-stage="${({ setup: 'setup', betting: 'game', reveal: 'reveal', settlement: 'settle', selected: 'settle' } as Record<string, string>)[phase]}"]`,
          )
          .evaluate((e) => (e as HTMLButtonElement).click());
        if (phase === 'selected') await approved.locator('[data-seat="0"]').click();
        await page.goto(
          `/e2e/design.html?n=${count}&phase=${phase === 'selected' ? 'settlement&selected=1' : phase}`,
        );
        if (phase === 'setup') await expect(page.locator('.setup-fields input')).toHaveCount(3);
        await approved.mouse.move(0, 0);
        await page.mouse.move(0, 0);
        const refBuffer = await approved.locator('.phone').screenshot({ animations: 'disabled' }),
          actualBuffer = await page.locator('.phone').screenshot({ animations: 'disabled' });
        const scale = await page.evaluate(() => devicePixelRatio);
        const cropHeader = (buffer: Buffer, cssHeight: number) => {
          const height = Math.round(cssHeight * scale);
          const full = PNG.sync.read(buffer),
            cropped = new PNG({ width: full.width, height: full.height - height });
          PNG.bitblt(full, cropped, 0, height, full.width, full.height - height, 0, 0);
          return cropped;
        };
        // Approved header change: 52px -> 60px. Compare the unchanged table and dock at the original threshold.
        const ref = cropHeader(refBuffer, 52),
          actual = cropHeader(actualBuffer, 60);
        expect([actual.width, actual.height]).toEqual([ref.width, ref.height]);
        const diff = new PNG({ width: ref.width, height: ref.height });
        const changed = pixelmatch(ref.data, actual.data, diff.data, ref.width, ref.height, {
          threshold: 0.1,
        });
        await writeFile(info.outputPath('approved.png'), refBuffer);
        await writeFile(info.outputPath('actual.png'), actualBuffer);
        await writeFile(info.outputPath('diff.png'), PNG.sync.write(diff));
        if (changed / (ref.width * ref.height) >= 0.002) {
          const inspect = async (p: typeof page) =>
            p
              .locator(
                '.seat.selected,.seat.selected .name,.seat.selected .bet,.seat.selected .stack',
              )
              .evaluateAll((ns) =>
                ns.map((n) => {
                  const c = getComputedStyle(n),
                    r = n.getBoundingClientRect();
                  return {
                    class: n.className,
                    rect: { y: r.y, x: r.x, width: r.width, height: r.height },
                    padding: c.padding,
                    border: c.border,
                    fontWeight: c.fontWeight,
                    lineHeight: c.lineHeight,
                    background: c.backgroundColor,
                    color: c.color,
                  };
                }),
              );
          console.log(
            JSON.stringify({ approved: await inspect(approved), actual: await inspect(page) }),
          );
        }
        expect(changed / (ref.width * ref.height)).toBeLessThan(0.002);
        await approved.close();
      });
