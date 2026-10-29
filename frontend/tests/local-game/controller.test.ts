import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { LocalRepository } from '../../src/features/local-game/storage/repository';
import { LocalController } from '../../src/features/local-game/storage/controller';
import { defaultSettings } from '../../src/game/settings';
it('저장 완료 응답 유실 재시도는 같은 요청이며 시작 1회', async () => {
  const r = new LocalRepository('controller-loss');
  const c = new LocalController(r, 'screen');
  await c.takeControl();
  await r.initialize({ ...defaultSettings, button: 0 }, c.lease!);
  await c.refresh();
  const real = r.dispatch.bind(r);
  let lost = true;
  r.dispatch = async (req) => {
    const result = await real(req);
    if (lost) {
      lost = false;
      return { status: 'UNKNOWN', requestId: req.requestId, state: null, reason: 'response lost' };
    }
    return result;
  };
  const a = await c.dispatch({ type: 'START_TOURNAMENT' });
  expect(a.status).toBe('UNKNOWN');
  expect(c.state?.status).toBe('setup');
  expect(c.pending?.sequence).toBe(1);
  const b = await c.retry();
  expect(b.status).toBe('APPLIED');
  expect(c.state?.pot).toBe(15);
  expect(c.state?.hand?.number).toBe(1);
  expect(c.pending).toBeNull();
  r.close();
});
for (const savedFirst of [false, true])
  it(`인수 중 늦은 응답은 예외나 최신 상태 덮어쓰기 없음 (${savedFirst ? '저장 선행' : '인수 선행'})`, async () => {
    const r = new LocalRepository('controller-race-' + savedFirst),
      c = new LocalController(r, 'a');
    await c.takeControl();
    await r.initialize({ ...defaultSettings, button: 0 }, c.lease!);
    await c.refresh();
    const real = r.dispatch.bind(r);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve)),
      started = new Promise<void>((resolve) => (entered = resolve));
    r.dispatch = async (request) => {
      if (savedFirst) {
        const result = await real(request);
        entered();
        await gate;
        return result;
      }
      entered();
      await gate;
      return real(request);
    };
    const pending = c.dispatch({ type: 'START_TOURNAMENT' });
    await started;
    await r.takeControl('b');
    await c.refresh();
    release();
    const result = await pending;
    expect(result.status).toBe(savedFirst ? 'APPLIED' : 'REJECTED');
    expect(result.reason).toBe('CONTROL_LOST');
    expect(c.lease).toBeNull();
    expect(c.pending).toBeNull();
    expect(c.state?.status).toBe(savedFirst ? 'playing' : 'setup');
    r.close();
  });
