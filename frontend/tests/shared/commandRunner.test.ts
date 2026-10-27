import { it, expect } from 'vitest';
import { createCommandRunner } from '../../src/shared/async/commandRunner';

it('실행 중에는 새 작업 대신 onBusy를 부르고 끝나면 잠금을 푼다', async () => {
  const runner = createCommandRunner();
  const calls: string[] = [];
  let release!: () => void;
  const first = runner.run(() => new Promise<void>((resolve) => (release = resolve)), {
    onStart: () => calls.push('start'),
    onRelease: () => calls.push('release'),
  });
  expect(runner.isLocked()).toBe(true);
  await runner.run(
    async () => {
      calls.push('second');
    },
    { onBusy: () => calls.push('busy') },
  );
  release();
  await first;
  expect(runner.isLocked()).toBe(false);
  expect(calls).toEqual(['start', 'busy', 'release']);
});

it('작업이 실패해도 onError 뒤에 잠금을 풀고 onRelease를 부른다', async () => {
  const runner = createCommandRunner();
  const calls: string[] = [];
  await runner.run(
    async () => {
      throw Error('boom');
    },
    {
      onError: (e) => calls.push(`error:${(e as Error).message}`),
      onRelease: () => calls.push(`release:${runner.isLocked()}`),
    },
  );
  expect(calls).toEqual(['error:boom', 'release:false']);
  await runner.run(async () => {
    calls.push('next');
  });
  expect(calls.at(-1)).toBe('next');
});
