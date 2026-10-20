import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openDB } from 'idb';
import { LocalRepository } from '../../src/local/repository';
import { LocalController } from '../../src/local/controller';
import { defaultSettings } from '../../src/game/settings';

it('명시적 새 토너먼트는 손상 저장을 원자 교체하고 이전 조작권을 무효화한다', async () => {
  const repo = new LocalRepository('recovery-corrupt');
  const old = await repo.takeControl('old');
  await repo.initialize(defaultSettings, old);
  const db = await openDB('recovery-corrupt');
  await db.put('slot', { schemaVersion: 999 }, 'current');
  await expect(repo.load()).rejects.toThrow();
  const { lease } = await repo.restart(defaultSettings, 'new');
  const saved = (await repo.load())!;
  expect(saved.state.players.map((p) => p.name)).toEqual(['P1', 'P2']);
  expect(saved.state.settings.button).toBe(-1);
  expect(saved.eventSequence).toBe(0);
  expect(lease.generation).toBeGreaterThan(old.generation);
  expect((await repo.control())?.screenId).toBe('new');
  expect(await repo.readEvents(saved.state.tournamentId, 0, 100)).toEqual([]);
  db.close();
  repo.close();
});

it('새 토너먼트 쓰기 실패는 이전 게임·기록·조작권을 그대로 보존한다', async () => {
  const repo = new LocalRepository('recovery-rollback');
  const lease = await repo.takeControl('old');
  await repo.initialize({ ...defaultSettings, button: 0 }, lease);
  const before = await repo.load(),
    owner = await repo.control();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'slot') throw new DOMException('full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await expect(repo.restart(defaultSettings, 'new')).rejects.toThrow('full');
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  expect(await repo.load()).toEqual(before);
  expect(await repo.control()).toEqual(owner);
  repo.close();
});

it('이전 복원 응답이 새 복원 결과를 덮어쓰지 않는다', async () => {
  const repo = new LocalRepository('recovery-late');
  const lease = await repo.takeControl('screen');
  await repo.initialize(defaultSettings, lease);
  const saved = (await repo.load())!;
  const controller = new LocalController(repo, 'screen');
  let release!: (value: typeof saved | null) => void;
  repo.load = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const earlier = controller.refresh();
  repo.load = async () => saved;
  await controller.refresh();
  release(null);
  await earlier;
  expect(controller.state?.tournamentId).toBe(saved.state.tournamentId);
  repo.close();
});
