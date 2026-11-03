import { readFileSync } from 'node:fs';

// 공용 계약 파일에서 실제 응답을 읽는다
export function fixture(name: string): unknown {
  const value = JSON.parse(
    readFileSync(new URL(`../../../shared/api-contract/${name}.json`, import.meta.url), 'utf8'),
  );
  return value.response ?? value;
}
