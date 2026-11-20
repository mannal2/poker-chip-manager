# 핸드 전환 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마지막 폴드로 핸드가 자동 정산되고 곧바로 다음 핸드가 시작될 때, 누가 얼마를 가져갔는지와 새 핸드가 시작됐다는 사실을 1.5초 안에 조작을 막지 않고 알린다.

**Architecture:** 두 가지 신호를 더한다. (1) 기존 칩 이동 효과(`useChipMotion.play`)에서 지급 칩이 도착할 때 수령자 카드 위에 `+금액` 글자가 떠오른다. 로컬과 온라인이 이 훅을 함께 쓰므로 두 모드에 같이 적용된다. (2) 공통 `GameScreen`이 핸드 번호 증가를 감지해, 테이블 펠트 테두리의 짧은 금빛과 헤더 `HAND` 숫자 강조를 한 번 재생한다.

**Tech Stack:** React 19, TypeScript, CSS keyframes, Web Animations API, Vitest(happy-dom), Playwright.

**Spec:** 별도 설계 문서 없음. 이 계획의 "결정 사항"과 [UX_SPEC.md](../../../UX_SPEC.md)의 2026-10-18·2026-10-21 움직임 규칙이 근거다. Task 3에서 UX_SPEC에 새 승인 절을 추가한다.

## 결정 사항 (2026-11-20 사용자 논의)

- 승자 카드에 금색 테두리를 쓰지 않는다. 금색 테두리(`.seat.active`)와 금색 점(`.turn`)은 "지금 차례"를 뜻하고, 새 핸드의 첫 행동자 카드도 바로 금색이 되므로 겹친다. 승자는 `+금액` 글자로만 알린다. 이 글자는 금색이 아닌 밝은 글자색을 쓴다.
- D·SB·BB 배지 이동 애니메이션은 넣지 않는다. 칩 이동·`+금액`·테두리 빛과 동시에 움직이면 과하다.
- 2026-10-21 폴드 자동 정산 후속의 "획득 toast는 생략한다"는 그대로 둔다. `+금액`은 toast가 아니라 카드 위 1.2초짜리 글자다. 이 차이를 UX_SPEC에 적는다.

## Global Constraints

- 모든 효과는 입력을 막지 않는다(`pointer-events: none`, 대기 없음).
- `prefers-reduced-motion: reduce`이면 새 효과를 모두 생략한다(`canAnimate()`와 CSS media query).
- 최초 표시·복원·재접속 첫 화면·무르기(핸드 번호 감소)에서는 핸드 시작 신호를 재생하지 않는다. 핸드 번호가 이전 렌더보다 커질 때만 재생한다.
- 시간 값: `+금액`은 지급 칩 출발 후 600ms에 나타나 1200ms 동안 위로 `16 * var(--u)` 떠오르며 사라진다. 펠트 금빛은 1000ms(30% 지점에서 가장 밝음). `HAND` 숫자 강조는 기존 단계 강조와 같은 520ms, 금색·1.1배→원래.
- 숫자는 `toLocaleString('ko-KR')`로 쉼표를 쓰고 K/M으로 줄이지 않는다.
- 새 함수·컴포넌트 위에는 역할을 한글 한 줄 주석으로 단다.

## Review Focus

- 공동 승자(쇼다운 WIN 확정): 각 수령자 카드에 자기 금액이 동시에 뜬다.
- 한 수령자가 여러 팟을 받는 경우: 같은 카드 위에 글자가 겹쳐 쌓이지 않고 합계 한 번만 뜬다.
- 폴드 종료에서 미콜 반환과 지급이 합쳐진 한 번의 이동: 합친 금액이 한 번 뜬다.
- 토너먼트가 끝나는 마지막 핸드: 핸드 번호가 늘지 않으므로 테두리 빛은 재생되지 않는다.
- 온라인에서 다른 사람의 폴드로 핸드가 넘어가도 내 화면에 같은 신호가 뜬다.

---

### Task 1: 지급 금액 글자

**Files:**
- Modify: `frontend/src/features/gameplay/model/chipTransfer.ts` (순수 함수 추가)
- Modify: `frontend/src/features/gameplay/hooks/useChipMotion.ts` (`play`에서 글자 생성)
- Modify: `frontend/src/features/gameplay/styles/controls.css` (`.chip-flight` 옆에 `.payout-gain`)
- Test: `frontend/tests/gameplay/chipTransfers.test.ts`, `frontend/e2e/chip-motion.spec.ts`

**Interfaces:**
- Produces: `payoutGains(moves: ChipTransfer[]): { to: string; amount: number; delay: number }[]` — `kind === 'payout'`인 이동만 수령자별로 합치고, `delay`는 그 수령자 이동 중 가장 늦은 값이다. 입력 순서대로 수령자를 나열한다.

- [ ] **Step 1: 실패하는 단위 테스트** — `chipTransfers.test.ts`에 추가한다.
  - `payoutGains([{from:'pot',to:'p1',amount:10,delay:0,kind:'bet'}])` → `[]`
  - 같은 `p1`에 `payout` 30(delay 0)과 20(delay 720) → `[{to:'p1',amount:50,delay:720}]`
  - `p1` 40, `p2` 40 (모두 delay 0) → 두 항목, 순서 p1, p2
- [ ] **Step 2:** `npx vitest run tests/gameplay/chipTransfers.test.ts` → 새 테스트가 FAIL
- [ ] **Step 3:** `payoutGains` 구현. `useChipMotion.play`에서 이동 노드를 만든 뒤, `payoutGains(prepared.moves)`마다 도착 좌표(`prepared.points.get(to)`)에 `span.payout-gain`(`aria-hidden`, 글자 `+${amount.toLocaleString('ko-KR')}`)을 `document.body`에 붙인다. 애니메이션: `[{opacity:0, transform:'translate(-50%,-50%)'}, {opacity:1, offset:0.2}, {opacity:0, transform:'translate(-50%, calc(-50% - 16 * unit px))'}]`, `duration 1200`, `delay: gain.delay + 600`, `fill:'both'`. 기존 노드처럼 `active`에 넣어 `clear()`로 정리되게 한다. 이동 거리 단위는 `prepare`가 이미 계산하는 `unit`을 `Prepared`에 함께 담아 쓴다.
- [ ] **Step 4:** CSS `.payout-gain`: `position: fixed; pointer-events: none; z-index`는 `.chip-flight`와 같게, `font-weight: 700; font-size: calc(13 * var(--u)); color: var(--text)`(금색 금지), 어두운 `text-shadow`로 펠트 위 대비 확보.
- [ ] **Step 5:** `chip-motion.spec.ts`에 마지막 폴드 시나리오를 추가한다. 폴드 직후 `.payout-gain`이 승자 금액 글자(쉼표 포함)로 나타나고, 2초 안에 DOM에서 사라지는지 확인한다. 기존 스펙의 "움직임 줄이기면 효과 없음" 사례가 있다면 `.payout-gain`도 0개인지 같은 사례에 단언을 더한다.
- [ ] **Step 6:** `npx vitest run tests/gameplay` 와 `npx playwright test chip-motion.spec.ts online/settlement.spec.ts` → PASS
- [ ] **Step 7: Commit** — `feat: show the amount a winner collects over their seat`

### Task 2: 새 핸드 시작 신호

**Files:**
- Create: `frontend/src/features/gameplay/hooks/useHandStartCue.ts`
- Modify: `frontend/src/features/gameplay/GameScreen.tsx`, `components/Table.tsx`, `components/GameHeader.tsx`
- Modify: `frontend/src/features/gameplay/styles/table.css`, `styles/header.css`
- Test: `frontend/tests/gameplay/handStartCue.test.tsx`(신규), `frontend/e2e/chip-motion.spec.ts`

**Interfaces:**
- Produces: `useHandStartCue(handNumber: number | undefined): number` — 마운트 시 0. 이후 렌더에서 `handNumber`가 직전 값보다 커지면 1씩 증가한 값을 돌려준다. 같거나 작아지면(무르기) 그대로 둔다. `undefined`는 비교에서 건너뛴다.
- `Table`과 `GameHeader`는 `cue: number` prop을 받는다. `cue > 0`일 때만 효과 요소를 그리고, `key={cue}`로 매 증가마다 애니메이션을 처음부터 재생한다.

- [ ] **Step 1: 실패하는 테스트** — `handStartCue.test.tsx`에서 작은 테스트 컴포넌트로 훅을 렌더한다.
  - 첫 렌더 `1` → 0
  - `1 → 2` → 1, 다시 `2 → 3` → 2
  - `3 → 2`(무르기) → 그대로 2
  - `undefined → 4` → 그대로, 그 뒤 `4 → 5` → 증가
- [ ] **Step 2:** `npx vitest run tests/gameplay/handStartCue.test.tsx` → FAIL
- [ ] **Step 3:** 훅 구현(`useRef`로 직전 번호 보관). `GameScreen`에서 `const cue = useHandStartCue(s.hand?.number)`를 `Table`과 `GameHeader`에 넘긴다.
- [ ] **Step 4:** `Table`: `.felt` 바로 뒤에 `{cue > 0 && <span key={cue} className="felt-glow" aria-hidden="true" />}`. CSS: `.felt`와 같은 `inset`·`border-radius`, `pointer-events: none`, `animation: felt-glow 1000ms ease-out both`; keyframes는 0% `box-shadow: 0 0 0 0 transparent` → 30% `0 0 calc(18 * var(--u)) calc(2 * var(--u)) #e2bd7566` + `border: calc(2 * var(--u)) solid #e2bd75aa` → 100% 투명.
- [ ] **Step 5:** `GameHeader`: `HAND` 숫자 `<strong>`에 `key={cue}`와 `cue > 0`일 때 `className="hand-cue"`. CSS `@keyframes hand-cue` 520ms, 0% 금색·`scale(1.1)` → 100% 원래 색·크기. `display: inline-block` 필요.
- [ ] **Step 6:** 두 CSS 모두 `@media (prefers-reduced-motion: reduce) { animation: none; }`이고 `.felt-glow`는 그때 `display: none`.
- [ ] **Step 7:** `chip-motion.spec.ts`에 단언을 더한다. 마지막 폴드 뒤 `.felt-glow`가 1개 생기고 헤더 숫자가 `02`이며 `.hand-cue`를 갖는다. 페이지를 새로 고친 직후에는 `.felt-glow`가 0개다.
- [ ] **Step 8:** `npx vitest run tests/gameplay` 와 `npx playwright test chip-motion.spec.ts` → PASS
- [ ] **Step 9: Commit** — `feat: mark the start of each new hand on the table`

### Task 3: 문서와 전체 검증

**Files:**
- Modify: `UX_SPEC.md` (끝에 `## 2026-11-20 승인 — 핸드 전환 표시` 절)
- Modify: `IMPLEMENTATION_PROGRESS.md` (작업 이력 한 줄, 기존 형식 따름)

- [ ] **Step 1:** UX_SPEC 새 절: 지급 `+금액` 글자(시간 값, 금색 금지 이유, toast와의 차이), 핸드 시작 시 펠트 금빛 1000ms와 HAND 숫자 520ms 강조, 재생 조건(번호 증가만), 배지 이동 미도입, 동작 줄이기 생략, 입력 비차단.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit -p . && npx vitest run && npx eslint src/features/gameplay tests/gameplay` → 모두 통과
- [ ] **Step 3:** 전체 E2E(`npx playwright test`, 약 4.5분, 병렬)를 돌린다. 공통 게임 화면을 바꿨기 때문이다.
- [ ] **Step 4:** 브라우저(375×812)에서 3인 게임의 마지막 폴드를 눌러 `+금액`, 펠트 빛, HAND 숫자 강조가 동시에 과하지 않은지 스크린샷으로 확인한다.
- [ ] **Step 5: Commit** — `docs: record the hand transition cues`
