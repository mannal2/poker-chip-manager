# 바이인 1단계(단일기기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일기기 모드에서 진행 중인 토너먼트에 새 플레이어 추가와 탈락자 재입장을 "바이인"으로 제공한다. 규칙은 공용 게임 픽스처로 고정한다.

**Architecture:** TypeScript 엔진에 `BUY_IN`·`CANCEL_BUY_IN` 명령을 더한다. 바이인한 사람은 새 플레이어 기록(새 id)으로 앉고, 첫 카드를 받기 전까지 `joining` 상태로 **접힌(folded) 채** 앉아 있어서 차례·블라인드·팟에서 자동으로 빠진다. `startHand`가 다음 핸드 위치를 계산할 때 대기자를 빼고 계산한 뒤, 버튼과 스몰 블라인드 사이가 아니면 참여시키고 위치를 다시 계산한다. 화면은 메뉴의 `바이인` → 탭 대화상자(새 플레이어 | 재입장)로 명령을 보낸다.

**Tech Stack:** React 19 + TypeScript, Vitest, Ajv(픽스처 스키마), Playwright

**Spec:** [docs/superpowers/specs/2026-11-19-buy-in-design.md](../specs/2026-11-19-buy-in-design.md)

## Global Constraints

- 브랜치: `buy-in`(이미 생성됨). push는 `git push -u origin buy-in`.
- 이번 단계는 TypeScript 엔진과 단일기기 화면만 바꾼다. Java 엔진·서버·멀티플레이 화면은 바꾸지 않는다.
- **새 규칙 오류 코드를 만들지 않는다.** `shared/error-codes.json`의 `rules`는 Java enum과 정확히 같아야 한다. 거절에는 기존 `INVALID_ACTION`, `INVALID_NAMES`, `INVALID_SEATS`를 쓴다.
- 바이인 칩은 `settings.initial` 전액이다. `initialTotal`도 같은 만큼 바꾼다(취소하면 뺀다).
- 좌석은 최대 10개다.
- 화면 문구는 합니다체를 쓰고, 호칭은 `플레이어`, `해 주세요`처럼 띄어 쓴다. 새 함수·컴포넌트 위에는 한 줄 한글 주석을 단다.
- 커밋 메시지에 Claude 표시를 넣지 않는다. 각 태스크 뒤에 검증하고 그 태스크만 커밋한다.

## Review Focus

1. 대기자가 있는 상태에서 참여 중인 생존자가 2명 미만이 되면(예: 2명 중 1명 탈락), 대기자를 기다리게 하지 말고 바로 참여시켜야 한다. 그렇지 않으면 다음 위치를 계산할 사람이 없다. → Task 2 `BUY14`
2. 2명(헤즈업)에서 바이인으로 3명이 되면 다음 핸드는 3명 규칙(버튼·SB·BB가 서로 다름)으로 계산되어야 한다. → Task 2 `BUY11`
3. 핸드 도중 `between`으로 자리를 끼워 넣으면 진행 중인 핸드의 버튼·SB·BB 좌석 번호가 같이 밀려 같은 사람을 가리켜야 한다. → Task 1 `BUY03`
4. 탈락자 빈자리를 차지한 바이인을 취소하면 탈락자 기록이 같은 자리로 돌아오고, 기록 화면의 이름도 유지되어야 한다. → Task 1 `BUY07`, Task 5 `keeps names of former players in history`
5. 바이인 뒤에 취소(UNDO)를 누르면 바이인이 사라지면 안 된다. → Task 1 `BUY08`

---

### Task 1: 엔진에 BUY_IN·CANCEL_BUY_IN 명령을 더한다

**Files:**
- Modify: `frontend/src/game/types.ts` (Player, GameState, GameCommand)
- Create: `frontend/src/game/commands/buyIn.ts`
- Modify: `frontend/src/game/transition.ts` (handlers에 `buyInHandlers` 추가)
- Create: `shared/game-fixtures/buyin.json`
- Modify: `shared/game-fixtures/schema.json` (suite enum과 lifecycle 형식 suite 목록에 `buyin` 추가)
- Modify: `frontend/tests/game/fixtureRunner.ts` (`suites`·`runners`에 `buyin: runLifecycle`), `frontend/tests/game/fixtures.test.ts` (`runFixtureSuite('buyin')`)

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type BuyInPlacement = { kind: 'between'; after: string } | { kind: 'replace'; playerId: string };
  // Player에 추가
  entry?: number;                        // 몇 번째 참가(없으면 1)
  joining?: 'next-hand' | 'button';      // 첫 카드 전 대기
  replaced?: Player;                     // 차지한 탈락자 기록(첫 카드 전까지만)
  // GameState에 추가
  formerPlayers?: { id: string; name: string }[];
  // GameCommand에 추가
  | { type: 'BUY_IN'; name?: string; placement: BuyInPlacement; reentryOf?: string }
  | { type: 'CANCEL_BUY_IN'; playerId: string }
  ```
- Produces (`commands/buyIn.ts`): `export const buyInHandlers`, `export function nextPlayerId(s: GameState): string` — 지금 플레이어와 `formerPlayers`의 `p<숫자>` 중 최댓값+1(`p<n>`).
- 이벤트: `BUY_IN { playerId, entry, reentryOf?, replaced? }`, `BUY_IN_CANCEL { playerId }`. `emit`으로 현재 핸드 번호에 남긴다.

규칙(설계 문서 "명령"·"좌석 번호가 바뀔 때"):
- 공통: `status === 'playing'`이 아니면 `INVALID_ACTION`.
- 새 플레이어(`reentryOf` 없음): `name`을 `normalizeName`으로 정규화한다. 실패하거나, 탈락하지 않은 사람(대기자 포함)과 대소문자 무시로 겹치면 `INVALID_NAMES`. `entry: 1`.
- 재입장(`reentryOf`): 대상이 `eliminated`가 아니면 `INVALID_ACTION`. 이름은 대상의 이름이고 `name`은 무시한다. 이름이 겹치면 `INVALID_NAMES`. `entry`는 대상 `entry ?? 1`에 1을 더한다.
- `between`: `players.length >= 10`이거나 `after`가 없으면 `INVALID_SEATS`. `after` 바로 뒤에 넣고, 진행 중인 핸드의 `buttonSeat`·`sbSeat`·`bbSeat`가 삽입 위치 이상이면 1을 더한다.
- `replace`: 대상이 `eliminated`가 아니거나 `joining`이면 `INVALID_SEATS`. 그 자리에 새 기록을 두고 `replaced`에 원래 기록을 보관한다. `formerPlayers`에 `{ id, name }`을 더한다.
- 새 기록: `stack = settings.initial`, `folded = true`, `B = H = 0`, `actedAt = null`, `reopenAt = 0`, `eliminated = false`, `joining = 'next-hand'`.
- `initialTotal += settings.initial`, `undo = null`.
- `CANCEL_BUY_IN`: 대상이 `joining`이 아니면 `INVALID_ACTION`. `replaced`가 있으면 그 기록을 같은 자리로 되돌리고 `formerPlayers`에서 뺀다. 없으면 자리를 지우고, 핸드 좌석 번호가 지운 위치보다 크면 1을 뺀다. `initialTotal -= settings.initial`, `undo = null`.

- [ ] **Step 1: 실패하는 픽스처를 쓴다** (`shared/game-fixtures/buyin.json`, 다른 lifecycle 형식 suite와 같은 모양. 각 케이스 `suite: "buyin"`)

| id | 상황 | 기대 |
|---|---|---|
| BUY01 | 3명 진행 중, `BUY_IN {name:'Dan', placement:{kind:'between', after:'p2'}}` | 4명, `players[3]` = `{id:'p3', name:'Dan', stack:1000, entry:1, joining:'next-hand', folded:true}`, `initialTotal` 4000, 이벤트 `BUY_IN` |
| BUY02 | 같은 상황에서 이름 `'p1'`과 대소문자만 다른 기존 이름, 또는 `'!!'` | `expectError: INVALID_NAMES` |
| BUY03 | 4명, 핸드 버튼=2·SB=3·BB=0, `between after:'p0'`(1번 자리에 삽입) | 핸드 `buttonSeat` 3, `sbSeat` 4, `bbSeat` 0. 같은 사람을 가리킴 |
| BUY04 | 10명일 때 `between` | `expectError: INVALID_SEATS` |
| BUY05 | p1 탈락 상태에서 `replace p1`로 새 플레이어 | 1번 자리가 새 기록, `replaced.id` = `p1`, `formerPlayers`에 p1 |
| BUY06 | p1 탈락(`entry` 없음) 상태에서 `reentryOf:'p1'`, `between after:'p2'` | 새 기록 이름 = p1의 이름, `entry: 2` |
| BUY07 | BUY05 뒤 `CANCEL_BUY_IN` | 1번 자리가 원래 p1 기록(`eliminated:true`), `formerPlayers` 비어 있음, `initialTotal` 원래대로 |
| BUY08 | CALL 뒤(undo 있음) `BUY_IN` → `UNDO` | `UNDO`는 `expectError: UNDO_LOCKED`. 새 플레이어가 남아 있음 |
| BUY09 | 탈락하지 않은 p1으로 `reentryOf:'p1'` | `expectError: INVALID_ACTION` |
| BUY10 | `status:'ended'`에서 `BUY_IN` | `expectError: INVALID_ACTION` |


- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run tests/game/fixtures.test.ts`
Expected: `buyin` 케이스 FAIL(명령 없음 / 스키마의 suite enum 불일치).

- [ ] **Step 3: 구현한다** — 위 Interfaces와 규칙대로 `buyIn.ts`를 만들고 `transition.ts`의 `handlers`에 더한다. 스키마 suite enum과 lifecycle 형식 suite 목록에 `buyin`을 더한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run tests/game`
Expected: PASS.
Run: `cd backend && ./gradlew :game:test :game-json:test`
Expected: PASS. Java는 suite를 이름 목록으로 읽으므로 `buyin`을 읽지 않는다.

- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/game frontend/tests/game shared/game-fixtures
git commit -m "feat: add buy-in and cancel commands to the game engine"
```

---

### Task 2: 다음 핸드에서 대기자를 참여시키거나 버튼까지 기다리게 한다

**Files:**
- Modify: `frontend/src/game/round.ts` (`startHand` 110-151행)
- Modify: `frontend/src/game/positions.ts` (`isBetweenButtonAndSb` 추가)
- Modify: `shared/game-fixtures/buyin.json` (케이스 추가)

**Interfaces:**
- Produces: `export function isBetweenButtonAndSb(seat: number, buttonSeat: number, sbSeat: number, size: number): boolean` — 시계 방향으로 버튼 다음부터 SB 직전까지(양 끝 제외)면 true. `buttonSeat === sbSeat`(헤즈업)이면 늘 false.
- `startHand` 순서(설계 문서 "다음 핸드 시작 때의 순서")
  1. `joining`인 사람을 `'button'` 후보로 둔다.
  2. 참여 중인 생존자(`!eliminated && !joining`)가 2명 미만이면 대기자를 모두 참여시킨다(Review Focus 1).
  3. 아니면 `!eliminated && !joining`로 위치를 계산하고, 버튼과 SB 사이가 아닌 대기자는 참여시킨다. 참여시킨 사람이 있으면 `!eliminated && !joining`로 위치를 다시 계산한다.
  4. 참여시킨 사람은 `joining`과 `replaced`를 지운다. 계속 기다리는 사람은 `joining = 'button'`이고 `folded = true`를 유지한다(초기화 루프 뒤에 다시 설정).
  5. `pending`과 블라인드 납부는 참여 중인 생존자만 대상으로 한다.
- 종료 판정(`settle`)은 바꾸지 않는다. 대기자는 `eliminated = false`라서 이미 생존자로 센다.

- [ ] **Step 1: 실패하는 픽스처를 더한다**

| id | 상황 | 기대 |
|---|---|---|
| BUY11 | 2명(헤즈업) + BUY_IN, 핸드 정산 | 다음 핸드 3명 참여, `buttonSeat`·`sbSeat`·`bbSeat`가 서로 다름, 새 플레이어 `joining` 없음 |
| BUY12 | 4명, 다음 핸드 버튼과 SB 사이 자리에 BUY_IN, 정산 | 새 플레이어 `joining:'button'`, `folded:true`, `pending`에 없음, 블라인드 안 냄 |
| BUY13 | BUY12에서 한 핸드 더 정산 | 버튼이 지나가 참여(`joining` 없음, 카드 받음) |
| BUY14 | 2명 + 버튼 대기자 1명, 정산으로 1명 탈락 | 토너먼트가 끝나지 않고 대기자가 바로 참여(2명 헤즈업) |
| BUY15 | 새 플레이어가 다음 핸드 BB 자리 | 그 핸드에서 바로 BB를 냄 |

- [ ] **Step 2: 실패를 확인한다** — Run: `cd frontend && npx vitest run tests/game/fixtures.test.ts` / Expected: BUY11~15 FAIL.
- [ ] **Step 3: 구현한다** — 위 순서대로 `startHand`를 고친다. `isBetweenButtonAndSb`는 `positions.ts`에 둔다.
- [ ] **Step 4: 통과를 확인한다** — Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run` / Expected: 전체 PASS(기존 lifecycle·undo·events 픽스처 포함).
- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/game shared/game-fixtures
git commit -m "feat: deal buy-ins in at the next hand or after the button passes"
```

---

### Task 3: 입장 화면의 탭을 공용 컴포넌트로 옮긴다

**Files:**
- Create: `frontend/src/shared/ui/Tabs.tsx`, `frontend/tests/shared/tabs.test.tsx`
- Modify: `frontend/src/features/online-game/components/OnlineEntry.tsx` (탭 부분을 `Tabs`로 교체)
- Modify: 탭 CSS를 `frontend/src/features/online-game/styles/online.css`의 `.entry-tabs`에서 공용 스타일(`frontend/src/shared/styles/base.css`의 `.tabs`)로 옮긴다

**Interfaces:**
- Produces: `export function Tabs<T extends string>({ tabs, selected, onSelect, disabled, label, idPrefix }: { tabs: readonly { id: T; label: string }[]; selected: T; onSelect: (id: T) => void; disabled?: boolean; label: string; idPrefix: string }): JSX.Element`
  - `role="tablist"`(`aria-label={label}`)과 `role="tab"` 버튼을 그린다. 탭에는 `aria-selected`, 활성 탭만 `tabIndex=0`, `aria-controls={`${idPrefix}-panel`}`, id는 `${idPrefix}-tab-${id}`를 준다.
  - 좌우 화살표로 다음·이전 탭을 고르고 포커스한다.
  - 패널(`role="tabpanel"`)은 호출하는 쪽이 그린다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `renders tabs with roving focus`, `moves with arrow keys`, `disables every tab`.
- [ ] **Step 2: 실패를 확인한다** — Run: `cd frontend && npx vitest run tests/shared/tabs.test.tsx`
- [ ] **Step 3: 구현하고 OnlineEntry를 바꾼다** — 입장 화면의 역할·id·화면 문구는 그대로 둔다(기존 `onlineEntry.test.tsx`가 그대로 통과해야 한다).
- [ ] **Step 4: 통과를 확인한다** — Run: `cd frontend && npx vitest run tests/shared tests/online-game` / Expected: PASS.
- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/shared frontend/src/features/online-game frontend/tests/shared
git commit -m "refactor: share the tab control"
```

---

### Task 4: 메뉴의 바이인 버튼과 바이인 대화상자를 만든다

**Files:**
- Create: `frontend/src/features/local-game/model/buyIn.ts`, `frontend/tests/local-game/buyIn.test.ts`
- Create: `frontend/src/features/local-game/components/BuyInDialog.tsx`, `frontend/tests/local-game/buyInDialog.test.tsx`
- Modify: `frontend/src/features/local-game/components/ManagerMenu.tsx`, `frontend/src/features/local-game/LocalGamePage.tsx:255-270`

**Interfaces:**
- Consumes: Task 1의 `BuyInPlacement`, `BUY_IN`·`CANCEL_BUY_IN`. Task 3의 `Tabs`. 기존 `renameError(name, others)`(`game/settings.ts`), `messageFor`.
- Produces (`model/buyIn.ts`)
  - `export function seatOptions(state: GameState): { key: string; placement: BuyInPlacement; label: string }[]`
    - 자리마다 "A와 B 사이"(`between after: A`) 항목을 만든다. 10자리면 만들지 않는다.
    - 탈락자(대기자 아님)마다 "C의 빈자리" 항목(`replace`)을 만든다.
    - 자리 순서대로 정렬한다.
  - `export function buyInBlockReason(state: GameState): string | null`
    - `status !== 'playing'`이면 `진행 중인 토너먼트에서만 바이인할 수 있습니다.`
    - 고를 자리가 없으면 `빈자리가 없어 바이인할 수 없습니다.`
    - 그 밖에는 `null`
- `ManagerMenu`에 `onBuyIn: () => void`와 `buyInBlockReason: string | null`을 더한다. 순서는 `홈`, `바이인`, `새 토너먼트`다. 막혔으면 `aria-disabled`로 두고, 누르면 이유를 토스트로 띄운다.
- `BuyInDialog({ state, busy, onSubmit, onClose })`. `onSubmit: (command: GameCommand) => Promise<boolean>`.
  - 탭: `새 플레이어`(기본) | `재입장`
    - 새 플레이어 탭: `이름` 입력. 칸 아래 도움말은 `다른 플레이어에게 보이는 이름입니다. 한글·영문·숫자·공백 1~10자로 정해 주세요.`이다. 오류(`renameError` → `messageFor`)는 칸 바로 아래에 띄운다.
    - 재입장 탭: 탈락자 목록(라디오). 탈락자가 없으면 `재입장할 탈락자가 없습니다.` 하나를 고르면 그 사람의 `replace` 자리를 자동으로 고른다.
  - `자리` 선택(`seatOptions`).
  - 안내 문구: `시작 칩 {initial}을 받고 다음 핸드부터 참여합니다. 버튼과 스몰 블라인드 사이 자리면 버튼이 지나간 뒤 참여합니다.`
  - 맨 위의 `대기 중인 바이인` 목록: `joining`인 사람마다 이름과 `바이인 취소` 버튼(`CANCEL_BUY_IN`)이 있다.
  - `바이인` 버튼으로 보낸다. 성공하면 닫고 `{이름} 바이인을 마쳤습니다. 바이인 전 행동은 취소할 수 없습니다.`를 토스트로 띄운다.
- `LocalGamePage`: `ManagerMenu`의 `onBuyIn`이 메뉴 대화상자를 닫고 `BuyInDialog`를 연다. `onSubmit`은 `session.dispatch`다.

설계 문서와 다른 점(계획 판단): 설계는 대기자 카드를 눌러 취소하게 했다. 카드 누르기는 정산 단계의 승자 선택과 겹치므로, 취소는 바이인 대화상자의 `대기 중인 바이인` 목록에서 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `buyIn.test.ts`: `lists between and empty-seat options in seat order`, `has no between options at ten seats`, `explains why buy-in is blocked`
  - `buyInDialog.test.tsx`: `opens on the new player tab`, `shows the name rule error under the field`, `preselects the original seat for a re-entry`, `says there is nobody to re-enter`, `sends BUY_IN with the chosen seat`, `cancels a waiting buy-in`
- [ ] **Step 2: 실패를 확인한다** — Run: `cd frontend && npx vitest run tests/local-game/buyIn.test.ts tests/local-game/buyInDialog.test.tsx`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 통과를 확인한다** — Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run` / Expected: PASS.
- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/features/local-game frontend/tests/local-game
git commit -m "feat: buy in from the single-device menu"
```

---

### Task 5: 좌석 표시와 기록에 바이인을 나타낸다

**Files:**
- Modify: `frontend/src/features/gameplay/model/tableView.ts:37-50` (`roles`, `entry`)
- Modify: `frontend/src/features/gameplay/components/PlayerSeat.tsx` (`×N` 표시, aria-label)
- Modify: `frontend/src/features/gameplay/model/history.ts` (`BUY_IN`, `BUY_IN_CANCEL` 줄)
- Modify: `frontend/src/features/gameplay/components/HistoryPanel.tsx` (이름 찾기에 `formerPlayers` 포함)
- Test: `frontend/tests/gameplay/tableView.test.ts`, `frontend/tests/gameplay/history.test.ts`

**Interfaces:**
- `tableView`의 좌석 `roles` 마지막 칸: `joining === 'next-hand'`이면 `다음 핸드부터`, `'button'`이면 `버튼 대기`다. `폴드`보다 먼저 판단한다. 좌석에 `entry: p.entry ?? 1`을 넘긴다.
- `PlayerSeat`: `entry > 1`이면 이름 옆에 `×{entry}`를 작게 보여 주고, aria-label에 ` {entry}번째 참가`를 더한다.
- `history.ts` 행 문구
  - `BUY_IN`: `entry === 1`이면 `{이름} - 바이인`, 아니면 `{이름} - 재입장({entry}번째)`
  - `BUY_IN_CANCEL`: `{이름} - 바이인 취소`
  - 두 이벤트를 표시 대상 종류에 더한다.
- `HistoryPanel`은 `historyRows(events, [...players, ...(formerPlayers ?? [])])`로 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `labels waiting buy-ins instead of folded`, `passes the entry count`, `writes buy-in, re-entry and cancel rows`, `keeps names of former players in history`
- [ ] **Step 2: 실패를 확인한다** — Run: `cd frontend && npx vitest run tests/gameplay`
- [ ] **Step 3: 구현한다**
- [ ] **Step 4: 통과를 확인한다** — Run: `cd frontend && npx vitest run` / Expected: PASS.
- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/features/gameplay frontend/tests/gameplay
git commit -m "feat: show waiting buy-ins, entry counts and buy-in history"
```

---

### Task 6: 문서와 E2E로 확인한다

**Files:**
- Modify: `SINGLE_DEVICE_MODE.md` (바이인 절과 결정 기록)
- Create: `frontend/e2e/buy-in.spec.ts`

- [ ] **Step 1: E2E를 쓴다** — 2명 게임을 시작하고 메뉴 → `바이인` → 이름 `Carol`과 첫 자리를 고른다. Carol 카드에 `다음 핸드부터`가 보이는지 확인한다. 폴드로 핸드를 끝내면 Carol이 대기 표시 없이 칩 1000으로 참여하는지 확인한다. 기록에 `Carol - 바이인`이 있는지 확인한다.
- [ ] **Step 2: 문서를 고친다** — 바이인 규칙(시작 칩 전액, 다음 핸드부터, 버튼 대기, 재입장 `×N`, 취소는 첫 카드 전까지, 바이인 뒤 이전 행동 취소 불가)과 2026-11-19 결정 기록을 적는다.
- [ ] **Step 3: 검증한다**
  - Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run && npm run build` / Expected: PASS
  - Run: `cd frontend && npx playwright test` / Expected: PASS(로컬 E2E 전체)
  - Run: `cd backend && ./gradlew :game:test` / Expected: PASS
- [ ] **Step 4: 커밋한다**

```bash
git add SINGLE_DEVICE_MODE.md frontend/e2e/buy-in.spec.ts
git commit -m "docs: describe single-device buy-in"
```
