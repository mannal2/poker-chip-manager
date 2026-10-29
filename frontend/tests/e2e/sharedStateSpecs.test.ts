import { readdirSync, readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { sharedStateSpecs } from '../../e2e/sharedStateSpecs';

const dir = new URL('../../e2e/', import.meta.url);
const specs = readdirSync(dir).filter((file) => file.endsWith('.spec.ts'));
/** A spec that both names dist/ and calls a file-changing fs function edits the shared build. */
const writesDist = (source: string) =>
  /['"`]dist\//.test(source) &&
  /\b(writeFile|appendFile|copyFile|rename|rm|unlink|truncate)(Sync)?\s*\(/.test(source);

it('dist/를 고치는 E2E spec은 모두 순차 실행 목록에 있다', () => {
  const writers = specs.filter((file) => writesDist(readFileSync(new URL(file, dir), 'utf8')));
  expect(writers.length).toBeGreaterThan(0);
  for (const file of writers)
    expect(sharedStateSpecs, `${file}를 e2e/sharedStateSpecs.ts에 추가하세요`).toContain(file);
});

it('순차 실행 목록에는 실제로 있는 spec만 있다', () => {
  for (const file of sharedStateSpecs) expect(specs, file).toContain(file);
});
