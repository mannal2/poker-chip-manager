import { test, expect } from '@playwright/test';
for (const width of [320, 360, 390, 430])
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10])
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
for (const width of [320, 390])
  for (const count of [2, 6, 9])
    for (const phase of ['setup', 'betting', 'reveal', 'settlement', 'selected'])
      test(`승인 HTML 색상·상태 비교 ${width} ${count} ${phase}`, async ({
        page,
        context,
      }, info) => {
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
        // Sizes and control rows were explicitly redesigned on 2026-10-20.
        // Keep the original approved HTML intact; compare the preserved visual contract.
        const appearance = async (p: typeof page, selector: string) =>
          p.locator(selector).evaluateAll((nodes) =>
            nodes
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => {
                const style = getComputedStyle(node);
                return {
                  background: style.backgroundColor,
                  image: style.backgroundImage,
                  color: style.color,
                  borderColor: style.borderTopColor,
                  borderStyle: style.borderTopStyle,
                  weight: style.fontWeight,
                };
              }),
          );
        try {
          for (const selector of [
            '.phone',
            '.dock',
            '.felt',
            '.seat',
            '.seat .name',
            '.seat .bet',
            '.seat .stack',
            '.seat .badge',
            '.chip',
            '.primary',
          ]) {
            const expected = await appearance(approved, selector);
            expect(await appearance(page, selector), selector).toEqual(expected);
          }
        } catch (error) {
          // Screenshots are for diagnosis only; the style comparison above is the assertion.
          await writeFile(
            info.outputPath('approved.png'),
            await approved.locator('.phone').screenshot({ animations: 'disabled' }),
          );
          await writeFile(
            info.outputPath('actual.png'),
            await page.locator('.phone').screenshot({ animations: 'disabled' }),
          );
          throw error;
        }
        await approved.close();
      });
