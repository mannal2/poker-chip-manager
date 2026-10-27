import { SetupPanel } from '../src/features/gameplay/components/SetupPanel';
import { SettlementPanel } from '../src/features/gameplay/components/SettlementPanel';
import { createRoot } from 'react-dom/client';
import { Table } from '../src/features/gameplay/components/Table';
import { BetControls } from '../src/features/gameplay/components/BetControls';
import '../src/shared/styles/tokens.css';
import '../src/shared/styles/base.css';
import '../src/features/gameplay/styles/header.css';
import '../src/features/gameplay/styles/table.css';
import '../src/features/gameplay/styles/controls.css';
const q = new URLSearchParams(location.search),
  n = Number(q.get('n') || 6),
  phase = q.get('phase') || 'betting';
const names = ['지우', '민준', '서연', '도윤', '하린', '유진', '지호', '수빈', '준서'],
  actor = n === 2 ? 1 : 2;
createRoot(document.getElementById('root')!).render(
  <main className="phone">
    <header className="meta">
      <div className="meta-info">
        <span>
          HAND <strong>01</strong>
        </span>
        <span id="blinds">
          <strong>5 / 10</strong>
        </span>
      </div>
      <button id="menu" aria-label="관리 메뉴">
        ☰
      </button>
    </header>
    <Table
      players={Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        eligible: true,
        name: q.has('stress') ? '가나다라마바사아자차' : names[i],
        stack: q.has('stress') ? 9000000 : phase === 'setup' || i === actor ? 1000 : 990,
        contribution: q.has('stress') ? 9000000 : phase === 'setup' || i === actor ? 0 : 10,
        roles:
          n === 2
            ? i === 1
              ? 'D · SB'
              : 'BB'
            : i === n - 1
              ? 'D'
              : i === 0
                ? 'SB'
                : i === 1
                  ? 'BB'
                  : '',
        active: phase === 'betting' && i === actor,
        selected: phase === 'settlement' && q.has('selected') && i === 0,
      }))}
      pot={(n - 1) * 10}
      phase={phase}
      street={phase === 'reveal' ? 'SHOWDOWN' : 'PREFLOP'}
      potLabel={phase === 'settlement' ? 'MAIN POT' : undefined}
    />
    <section className="dock">
      {phase === 'betting' ? (
        <BetControls call={10} />
      ) : phase === 'settlement' ? (
        <SettlementPanel count={q.has('selected') ? 1 : 0} busy={false} onWin={() => {}} />
      ) : phase === 'setup' ? (
        <SetupPanel
          settings={{
            names: names.slice(0, n),
            initial: 1000,
            sb: 5,
            bb: 10,
            button: n - 1,
          }}
          busy={false}
          onSave={() => {}}
          onStart={() => {}}
        />
      ) : (
        <div className="actions">
          <button>베팅 취소</button>
          <button className="primary">카드 공개</button>
        </div>
      )}
    </section>
  </main>,
);
