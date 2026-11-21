import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerSeat } from '../../src/features/gameplay/components/PlayerSeat';

const base = { id: 'p1', name: 'A', stack: 100, contribution: 0 };
// 좌석 카드를 정적 마크업으로 그린다
const html = (player: Parameters<typeof PlayerSeat>[0]['player']) =>
  renderToStaticMarkup(<PlayerSeat player={player} phase="betting" style={{}} />);

it('대기 중인 바이인 좌석은 폴드가 아니라 합류 시점을 읽어 준다', () => {
  const next = html({ ...base, folded: true, out: false, joining: 'next-hand' });
  expect(next).toContain('aria-label="A 다음 핸드부터"');
  expect(next).not.toContain('폴드');
  expect(next).toContain('out');
  expect(html({ ...base, folded: true, joining: 'button' })).toContain('A 버튼 대기');
  expect(html({ ...base, folded: true })).toContain('A 폴드');
});
