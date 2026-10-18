import { test, expect, type Page } from '@playwright/test';
import { openLocal } from './helpers';
async function ready(page: Page, n = 6) {
  await page.goto('/local/');
  await openLocal(page);
  for (let i = 2; i < n; i++) {
    await page.getByRole('button', { name: '참가자 추가', exact: true }).click();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  }
}
async function positions(page: Page) {
  return page
    .locator('.seat')
    .evaluateAll((es) =>
      Object.fromEntries(
        es.map((e) => [
          e.querySelector('.name')!.textContent,
          [(e as HTMLElement).style.left, (e as HTMLElement).style.top],
        ]),
      ),
    );
}
for (const rotated of [false, true])
  test(`원형 경계 삽입은 전체 회전 없이 인접 카드만 이동 ${rotated}`, async ({ page }) => {
    await ready(page);
    if (rotated) {
      await page.getByRole('button', { name: '화면 기준 한 자리 회전' }).click();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    }
    const from = page.getByRole('group', { name: 'P1', exact: true });
    const to = page.getByRole('group', { name: 'P6', exact: true });
    await from.locator('.card-values').hover();
    const before = await positions(page),
      a = (await from.locator('.card-values').boundingBox())!,
      b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    const after = await positions(page);
    expect(after.P1).toEqual(before.P6);
    expect(after.P6).toEqual(before.P1);
    for (const name of ['P2', 'P3', 'P4', 'P5']) expect(after[name]).toEqual(before[name]);
    await page.reload();
    await openLocal(page);
    expect(await positions(page)).toEqual(after);
  });
test('이름 글자 밖은 딜러 선택, 글자는 이름 편집', async ({ page }) => {
  await ready(page, 2);
  const row = page.locator('.seat .name').first(),
    text = page.getByRole('button', { name: 'P1 이름 수정', exact: true });
  const r = (await row.boundingBox())!,
    t = (await text.boundingBox())!;
  expect(t.width).toBeLessThan(r.width / 2);
  await expect(text).toHaveCSS('height', '23px');
  await expect(text).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.click(r.x + 3, r.y + r.height / 2);
  await expect(page.getByRole('textbox', { name: 'P1 이름 수정' })).toHaveCount(0);
  await expect(page.locator('.seat .badge').first()).toContainText('D');
  await text.click();
  await expect(page.getByRole('textbox', { name: 'P1 이름 수정' })).toBeVisible();
});
test('기록·메뉴·블라인드는 바깥 클릭 닫기, 회전은 준비에만', async ({ page }) => {
  await ready(page, 2);
  await page.getByRole('button', { name: '관리 메뉴', exact: true }).click();
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toHaveCount(0);
  await page.getByRole('dialog').click({ position: { x: 15, y: 15 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.seat .card-values').first().click();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '화면 기준 한 자리 회전' })).toHaveCount(0);
  await page.getByRole('button', { name: '다음 핸드 블라인드 설정', exact: true }).click();
  const sb = (await page.getByLabel('다음 SB', { exact: true }).boundingBox())!,
    bb = (await page.getByLabel('다음 BB', { exact: true }).boundingBox())!;
  expect(Math.abs(sb.y - bb.y)).toBeLessThan(2);
  expect(bb.x).toBeGreaterThan(sb.x + sb.width);
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toHaveCount(0);
  await page.getByLabel('다음 SB', { exact: true }).fill('15');
  await page.mouse.click(3, 3);
  await expect(page.locator('.pending-blinds')).toHaveCount(0);
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  await expect(page.getByRole('button', { name: '닫기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '최신순 ↓', exact: true })).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('카드 사이 삽입은 빈자리까지 필요한 구간만 이동', async ({ page }) => {
  await ready(page);
  const before = await positions(page);
  const from = page.getByRole('group', { name: 'P1', exact: true });
  await from.locator('.card-values').hover();
  const a = (await from.locator('.card-values').boundingBox())!,
    b = (await page.getByRole('group', { name: 'P5', exact: true }).boundingBox())!,
    c = (await page.getByRole('group', { name: 'P6', exact: true }).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(
    (b.x + b.width / 2 + c.x + c.width / 2) / 2,
    (b.y + b.height / 2 + c.y + c.height / 2) / 2,
    { steps: 15 },
  );
  await expect
    .poll(() => positions(page))
    .toMatchObject({
      P2: before.P2,
      P3: before.P3,
      P4: before.P4,
      P5: before.P5,
      P6: before.P1,
    });
  await page.mouse.up();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  expect((await positions(page)).P1).toEqual(before.P6);
});
for (const n of [2, 3, 4, 5, 7, 8, 9])
  test(`원형 경계 ${n}인 이름줄 빈 공간 드래그`, async ({ page }) => {
    await ready(page, n);
    const from = page.getByRole('group', { name: 'P1', exact: true }),
      to = page.getByRole('group', { name: `P${n}`, exact: true });
    await from.hover();
    const before = await positions(page),
      a = (await from.locator('.name').boundingBox())!,
      b = (await to.boundingBox())!;
    await page.mouse.move(a.x + 3, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    const after = await positions(page);
    expect(after.P1).toEqual(before[`P${n}`]);
    expect(after[`P${n}`]).toEqual(before.P1);
    for (let i = 2; i < n; i++) expect(after[`P${i}`]).toEqual(before[`P${i}`]);
    await expect(page.getByRole('textbox', { name: 'P1 이름 수정' })).toHaveCount(0);
    await expect(page.locator('.seat .badge')).toHaveCount(0);
  });
test('기록 기본 오래된 순·전체 역순·핸드 묶음·100건 경계 취소', async ({ page }) => {
  await ready(page, 2);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('poker-chip-manager');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['slot', 'events'], 'readwrite'),
        request = tx.objectStore('slot').get('current');
      request.onsuccess = () => {
        const saved = request.result,
          tid = saved.state.tournamentId,
          ids = saved.state.players.map((p: { id: string }) => p.id);
        let sequence = saved.eventSequence;
        const emit = (type: string, hand: number, details: unknown) => {
          sequence++;
          tx.objectStore('events').put(
            { id: 'fixture-' + sequence, sequence, tournamentId: tid, hand, type, details, at: '' },
            [tid, sequence],
          );
        };
        for (let i = 1; i <= 120; i++)
          emit('BET', i <= 60 ? 1 : 2, { playerId: ids[0], additional: i * 5 });
        emit('SET_VIEW', 2, {});
        emit('UNDO', 2, {});
        emit('CHECK', 2, { playerId: ids[1] });
        emit('PAYOUT', 2, { payouts: { [ids[0]]: 300, [ids[1]]: 300 } });
        saved.eventSequence = sequence;
        tx.objectStore('slot').put(saved, 'current');
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.getByRole('button', { name: '현재 토너먼트 기록', exact: true }).click();
  const list = page.locator('.history-list');
  await expect(list.locator('[data-kind=action]').first()).toHaveText('P1 - 베팅 5칩');
  await expect(list.locator('.history-hand')).toHaveText(['HAND 01']);
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await expect(list.locator('.history-hand')).toHaveText(['HAND 01', 'HAND 02']);
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await expect(list).not.toContainText('베팅 600칩');
  await expect(list).toContainText('P2 - 체크');
  await expect(list.locator('li').last()).toHaveText('P2 - 300칩 획득');
  await expect(list).not.toContainText('설정');
  await page.getByRole('button', { name: '최신순 ↓', exact: true }).click();
  await expect(list.locator('.history-hand')).toHaveCount(0);
  await expect(list.locator('[data-kind=action]').first()).toHaveText('P2 - 300칩 획득');
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await expect(list.locator('.history-hand')).toHaveText(['HAND 02', 'HAND 01']);
  await expect(list.locator('li').last()).toHaveText('HAND 01');
  await page.getByRole('button', { name: '오래된순 ↑', exact: true }).click();
  await expect(list.locator('[data-kind=action]').first()).toHaveText('P1 - 베팅 5칩');
});

test('반대편까지 이어서 드래그해도 이미 지나온 방향을 뒤집지 않음', async ({ page }) => {
  await ready(page);
  const from = page.getByRole('group', { name: 'P1', exact: true });
  await from.locator('.card-values').hover();
  const before = await positions(page),
    a = (await from.locator('.card-values').boundingBox())!;
  const targets = [];
  for (const name of ['P6', 'P5', 'P4']) {
    const b = (await page.getByRole('group', { name, exact: true }).boundingBox())!;
    targets.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  for (const t of targets) await page.mouse.move(t.x, t.y, { steps: 12 });
  await expect
    .poll(() => positions(page))
    .toMatchObject({
      P2: before.P2,
      P3: before.P3,
      P4: before.P5,
      P5: before.P6,
      P6: before.P1,
    });
  await page.mouse.up();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const after = await positions(page);
  expect(after.P1).toEqual(before.P4);
  expect(after.P2).toEqual(before.P2);
  expect(after.P3).toEqual(before.P3);
});
