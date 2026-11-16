# 멀티플레이 입장 화면 탭 분리와 칸별 오류 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 멀티플레이 첫 화면을 `방 만들기 | 방 참가` 탭으로 나누고, 이름·방 코드 오류와 좌석 이름 편집 오류를 해당 칸 바로 아래에 띄운다.

**Architecture:** `OnlineController`의 화면 상태(`OnlineView`)에 `errorField: 'name' | 'code' | null`을 추가해 어느 칸의 오류인지 싣는다. `OnlineEntry`는 탭 상태를 직접 들고 칸 오류를 칸 아래에 그리며, `OnlineApp`은 칸에 묶이지 않은 오류만 일반 알림으로 그린다. 좌석 이름 편집은 `InlineName`의 `onSave`가 오류 문구(문자열)를 돌려줄 수 있게 바꿔, 편집을 유지한 채 입력 아래에 띄운다.

**Tech Stack:** React 19 + TypeScript, Vitest(jsdom), Playwright

**Spec:** [docs/superpowers/specs/2026-11-16-online-entry-tabs-design.md](../specs/2026-11-16-online-entry-tabs-design.md)

## Global Constraints

- 브랜치: `entry-tabs` (`origin/main`에서 분기, 이미 생성됨). push는 `git push -u origin entry-tabs`로 한다(추적 대상이 main이므로 이름을 꼭 적는다).
- 화면 문구는 합니다체, 호칭은 `플레이어`, `해 주세요` 띄어쓰기.
- 새 함수·컴포넌트 위에는 역할을 한 줄 한글 주석으로 단다.
- 이름 도움말 문구: `다른 플레이어에게 보이는 이름입니다. 한글·영문·숫자·공백 1~10자로 정해 주세요.`
- 복구 안내 문구: `이전에 이 방에 참가했던 플레이어만 사용할 수 있습니다.`
- 복구 버튼 이름 `기존 플레이어로 복구`, 제출 버튼 이름 `방 만들기`·`방 참가`는 바꾸지 않는다.
- 커밋 메시지에 Claude 표시를 넣지 않는다. 각 태스크 뒤에 검증하고 그 태스크만 커밋한다.

## Review Focus

1. 링크로 들어온 사람이 `방 만들기` 탭으로 바꿨다가 돌아와도 방 코드와 이름이 남아 있어야 한다 → Task 2 `keeps the typed name and code when switching tabs`.
2. 요청 중에는 탭을 바꿀 수 없어야 한다(진행 중인 요청의 화면이 사라지지 않게) → Task 2 `disables the tabs while a request is pending`.
3. 칸 오류는 그 칸을 고치거나 탭을 바꾸면 사라지고, 일반 알림과 두 번 겹쳐 뜨지 않아야 한다 → Task 2 `clears a field error when the field is edited`, `shows a field error only under its field`.
4. 서버가 참가 요청을 `DUPLICATE_NAME`으로 거절하면 이름 칸 아래에 떠야 한다 → Task 1 `ties a duplicate name rejection to the name field`.
5. 온라인 대기방에서 다른 참가자와 대소문자만 다른 이름으로 바꾸면 요청 없이 칸 아래에 중복 오류가 떠야 한다 → Task 3 `rejects a case-insensitive duplicate online without sending`.

---

### Task 1: 화면 상태에 오류가 묶인 칸을 싣는다

**Files:**
- Modify: `frontend/src/features/online-game/session/onlineController.ts` (`OnlineView` 34-43행, `update`, `requestRecovery` 215-233행, `rejectsName` 235-240행, 입장 거절 처리 630-645행)
- Test: `frontend/tests/online-game/onlineController.test.ts`

**Interfaces:**
- Produces:
  - `export type EntryField = 'name' | 'code';`
  - `OnlineView.errorField: EntryField | null` (초기값 `null`)
  - `OnlineController.clearFieldError(field: EntryField): void` — 현재 `errorField`가 `field`이면 `error`와 `errorField`를 `null`로 바꾼다. 다르면 아무것도 하지 않는다.
  - `export function entryErrorField(code: string | undefined): EntryField | null` — `INVALID_NAME`·`DUPLICATE_NAME`·`RECOVERY_TARGET_NOT_FOUND` → `'name'`, `ROOM_NOT_FOUND` → `'code'`, 나머지 → `null`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`onlineController.test.ts`, 기존 컨트롤러 테스트의 가짜 API 도우미를 그대로 쓴다)

```ts
// 이름 검사 실패는 이름 칸에 묶인다
it('ties a client-side name rejection to the name field', async () => {
  // controller.create('') → getView().errorField === 'name', error === messageFor('INVALID_NAME')
});
// 복구 전 방 코드 형식 실패는 방 코드 칸에 묶인다
it('ties a malformed recovery code to the code field', async () => {
  // requestRecovery('ABC123', 'Alice') → errorField === 'code'
});
// 서버의 중복 이름 거절은 이름 칸에 묶인다
it('ties a duplicate name rejection to the name field', async () => {
  // join 요청에 409 { code: 'DUPLICATE_NAME' } → phase 'entry', errorField === 'name'
});
// 없는 방 거절은 방 코드 칸에 묶이고 연결 실패는 어느 칸에도 묶이지 않는다
it('ties a missing room to the code field and leaves connection errors unbound', async () => {
  // ROOM_NOT_FOUND → 'code'; ROOM_FULL → null; 연결 실패(open 실패) → null
});
// 칸 오류는 같은 칸에서만 지워진다
it('clears a field error only for its own field', async () => {
  // name 오류 상태에서 clearFieldError('code') → 그대로, clearFieldError('name') → error·errorField null
});
```

각 주석에 적은 값을 그대로 단언한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run tests/online-game/onlineController.test.ts`
Expected: 새 테스트 5건 FAIL(`errorField`, `clearFieldError` 없음).

- [ ] **Step 3: 구현한다**

`entryErrorField`를 같은 파일(또는 `session/` 안의 작은 파일)에 둔다. `update(patch)`에서 `patch`에 `error`가 있고 `errorField`가 없으면 `errorField: null`을 함께 넣어, 오류를 바꾸는 기존 모든 경로가 자동으로 칸 묶음을 지우게 한다. 칸에 묶는 곳만 명시한다: `rejectsName`(`'name'`), `requestRecovery`의 이름 검사(`'name'`)와 방 코드 검사(`'code'`), 입장·복구 요청이 거절된 분기(`errorField: entryErrorField(result.code)`). `clearFieldError`를 추가한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run tests/online-game`
Expected: 전체 PASS. 기존 `OnlineView` 리터럴을 만드는 테스트가 타입 오류를 내면 `errorField: null`을 추가한다.

- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/features/online-game/session frontend/tests/online-game
git commit -m "feat: tie entry errors to the name and code fields"
```

---

### Task 2: 입장 화면을 탭으로 나누고 칸 오류를 칸 아래에 띄운다

**Files:**
- Modify: `frontend/src/features/online-game/components/OnlineEntry.tsx`
- Modify: `frontend/src/features/online-game/OnlineApp.tsx:49`
- Modify: `frontend/src/features/online-game/styles/online.css`
- Test: `frontend/tests/online-game/onlineEntry.test.tsx`
- Modify(선택자): `frontend/e2e/online/managementSupport.ts`, `entry.spec.ts`, `recovery-validation.spec.ts`, 그리고 `getByLabel('이름', { exact: true })`를 쓰는 온라인 spec 전체(betting, forfeit-leave, full-tournament, host-tools, recovery, settlement, waiting-room)

**Interfaces:**
- Consumes: Task 1의 `OnlineView.errorField`, `controller.clearFieldError(field)`, `EntryField`.
- Produces: 화면 계약(테스트와 E2E가 의존):
  - 탭: `role="tablist"` 안의 `role="tab"` 두 개, 이름 `방 만들기`·`방 참가`, 선택된 탭은 `aria-selected="true"`. 패널은 `role="tabpanel"`.
  - 입력 라벨: `내 이름`(name="name"), `방 코드`(name="code").
  - 칸 오류: `<p role="alert" id="entry-name-error">` / `id="entry-code-error"`, 해당 입력에 `aria-invalid="true"`와 `aria-describedby`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`onlineEntry.test.tsx`)

```tsx
// 코드 없이 열면 방 만들기 탭이, 링크로 열면 방 참가 탭이 선택된다
it('opens the create tab by default and the join tab from an invite link', ...);
//   '/online/' → 선택된 tab 이름 '방 만들기', 'code' 입력 없음, '방 참가' 제출 버튼 없음
//   '/online/?code=ab12cd' → 선택된 tab '방 참가', code 입력 값 'AB12CD'
// 이름 칸은 내 이름 라벨과 늘 보이는 도움말을 가진다
it('labels the name as the player name with a visible rule', ...);
//   label 텍스트 '내 이름', 도움말 문구(Global Constraints) 표시
// 탭을 바꿔도 입력한 이름과 코드가 남는다
it('keeps the typed name and code when switching tabs', ...);
// 요청 중에는 탭을 바꿀 수 없다
it('disables the tabs while a request is pending', ...);
//   view.pending=true → 두 tab 모두 disabled
// 칸 오류는 그 칸 아래에만 뜨고 일반 알림으로 겹쳐 뜨지 않는다
it('shows a field error only under its field', ...);
//   errorField='name' 상태의 OnlineApp → [role=alert] 정확히 1개, id 'entry-name-error',
//   name 입력 aria-invalid='true', aria-describedby에 'entry-name-error' 포함
// 칸을 고치면 그 칸의 오류가 사라진다
it('clears a field error when the field is edited', ...);
// 탭을 바꾸면 칸 오류가 사라진다
it('clears field errors when the tab changes', ...);
// 칸과 무관한 오류는 일반 알림으로 남는다
it('keeps unbound errors in the general alert', ...);
```

기존 테스트 `keeps an invalid name rejection visible...`, `validates recovery name and code...`는 새 구조에 맞게 고친다(복구는 `방 참가` 탭에서 누르고, 오류는 `#entry-name-error`·`#entry-code-error`에서 읽는다). 버튼을 순서 인덱스(`querySelectorAll('button')[2]`)로 찾는 곳은 이름으로 찾도록 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run tests/online-game/onlineEntry.test.tsx`
Expected: 새 테스트 FAIL.

- [ ] **Step 3: 구현한다**

`OnlineEntry`에 `const [tab, setTab] = useState<'create' | 'join'>(() => (초기 code ? 'join' : 'create'))`를 둔다. 이름·코드 상태는 지금처럼 컴포넌트 위쪽에 두어 탭과 무관하게 유지한다. 탭 전환과 각 입력의 `onChange`에서 `controller.clearFieldError(...)`를 부른다(탭 전환은 `'name'`과 `'code'` 둘 다). 탭은 `view.pending`이면 `disabled`. 칸 오류는 `view.errorField === 'name'`이면 이름 칸 아래에 도움말 대신 오류를 띄운다(도움말과 오류를 동시에 두지 않는다). `OnlineApp`의 일반 알림은 `view.error && !view.errorField`일 때만 그린다. 탭 모양은 두 칸짜리 분할 버튼으로, 선택된 탭을 `.primary`와 같은 강조색으로 표시한다. 칸 오류 글자색·크기는 `.field-error`를 따른다.

- [ ] **Step 4: 단위 테스트를 확인한다**

Run: `cd frontend && npx vitest run tests/online-game`
Expected: 전체 PASS.

- [ ] **Step 5: E2E 선택자를 고친다**

`getByLabel('이름', { exact: true })` → `getByLabel('내 이름', { exact: true })`로 모두 바꾼다. 코드 없이 `/online/`을 연 뒤 방 코드를 입력하거나 복구를 누르는 곳(`entry.spec.ts`의 `shows a missing room rejection`, `recovery-validation.spec.ts` 첫 테스트)은 먼저 `getByRole('tab', { name: '방 참가' }).click()`을 넣는다. 오류를 `getByRole('alert')`로 읽는 곳 중 칸 오류인 것은 그대로 동작한다(alert가 하나만 뜨므로).

- [ ] **Step 6: 커밋한다**

```bash
git add frontend/src/features/online-game frontend/tests/online-game frontend/e2e/online
git commit -m "feat: split online entry into create and join tabs"
```

---

### Task 3: 좌석 이름 편집 오류를 편집 칸 아래에 띄운다

**Files:**
- Modify: `frontend/src/features/gameplay/components/InlineName.tsx`
- Modify: `frontend/src/features/gameplay/components/PlayerSeat.tsx:55`, `Table.tsx:23` (`onRename` 타입)
- Modify: `frontend/src/features/gameplay/hooks/useSetupEditing.ts:79-99` (로컬 이름 변경)
- Modify: `frontend/src/features/online-game/hooks/useOnlineGameSession.ts:124-129` (온라인 이름 변경)
- Modify: `frontend/src/features/gameplay/styles/table.css` (오류 말풍선)
- Create: `frontend/tests/gameplay/inlineName.test.tsx`, `frontend/tests/game/renameError.test.ts`
- Test: `frontend/tests/online-game/useOnlineGameSession.test.tsx` (로컬 `rename`의 연결은 Task 4의 로컬 E2E로 확인한다. `useSetupEditing`에는 단위 테스트가 없다)

**Interfaces:**
- Produces:
  - `onSave` / `onRename` 반환 타입: `boolean | string | Promise<boolean>` — 문자열이면 저장을 거절한 이유이고, `InlineName`은 편집을 유지한 채 그 문구를 입력 아래 `<span role="alert" className="inline-name-error">`로 띄운다. 입력에는 `aria-invalid="true"`를 단다. 다음 입력 변경이나 `Escape`로 문구를 지운다.
  - `export function renameError(name: string, others: string[]): 'INVALID_NAME' | 'DUPLICATE_NAME' | null` (`frontend/src/game/settings.ts`) — `normalizeName`이 실패하면 `'INVALID_NAME'`, 정규화한 이름이 `others` 중 하나와 대소문자 무시로 같으면 `'DUPLICATE_NAME'`, 아니면 `null`. `game/`은 화면 문구 모듈을 모르므로 코드만 돌려주고, 호출자가 `messageFor(code)`로 문구를 만든다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
// InlineName: 저장이 문구로 거절되면 편집을 유지하고 입력 아래에 띄운다
it('keeps editing and shows the reason when saving is refused with a message', ...);
//   onSave → '같은 이름이 이미 있습니다.' ; input 남아 있음, role=alert 텍스트 일치, aria-invalid='true'
// InlineName: 다시 입력하면 문구가 사라진다
it('clears the refusal message on the next edit', ...);
// renameError: 규칙 위반과 대소문자 무시 중복을 구분한다 (tests/game/renameError.test.ts)
it('names the rule for an invalid name and the duplicate for a taken one', ...);
//   renameError('!!', ['Bob']) → 'INVALID_NAME', renameError('bob', ['Bob']) → 'DUPLICATE_NAME',
//   renameError(' Ann ', ['Bob']) → null
// 온라인 대기방: 대소문자만 다른 중복 이름은 요청 없이 거절한다
it('rejects a case-insensitive duplicate online without sending', ...);
//   다른 참가자 'Bob' → rename(me, 'bob') === messageFor('DUPLICATE_NAME'), controller.send 호출 없음
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run tests/gameplay/inlineName.test.tsx tests/game/renameError.test.ts tests/online-game/useOnlineGameSession.test.tsx`
Expected: 새 테스트 FAIL.

- [ ] **Step 3: 구현한다**

`InlineName.save()`에서 `onSave` 결과가 문자열이면 `setRefusal(문구)` 후 `false`를 돌려주고 편집을 닫지 않는다. 말풍선은 카드 크기를 바꾸지 않도록 입력 기준 `position: absolute`로 아래에 겹쳐 띄운다. 로컬 `rename`은 `renameError(name, 다른 플레이어 이름들)` 결과가 있으면 `messageFor(code)` 문구를 돌려주고 `notify`를 부르지 않는다(그 밖의 `validateSettings` 실패는 지금처럼 `notify`). 온라인 `rename`은 보내기 전에 `renameError(name, 다른 참가자 이름들)`로 검사해 `messageFor(code)` 문구를 돌려준다. 서버가 그래도 거절하는 경합은 지금처럼 화면 위 알림으로 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src frontend/tests
git commit -m "feat: show seat rename errors under the name field"
```

---

### Task 4: 문서를 고치고 E2E로 확인한다

**Files:**
- Modify: `MULTIPLAYER_MODE.md` (입장 화면 설명), `ARCHITECTURE.md` (입장 화면·오류 표시 설명이 있으면)
- Modify: 좌석 이름 오류가 토스트로 뜬다고 검사하는 로컬 E2E가 있으면 그 spec

- [ ] **Step 1: 문서를 고친다**

`MULTIPLAYER_MODE.md`에서 입장 화면 구성을 설명하는 부분을 찾아 탭 구조, 링크로 들어오면 참가 탭이 열린다는 점, 칸별 오류 규칙을 반영한다. 결정 기록이 있으면 2026-11-16 한 줄을 추가한다.

- [ ] **Step 2: 타입 검사와 빌드를 확인한다**

Run: `npm --prefix frontend run build`
Expected: 오류 없음.

- [ ] **Step 3: 로컬 E2E 중 이름 편집 관련 spec을 실행한다**

Run: `npm --prefix frontend run test:e2e -- name-scope.spec.ts interaction-revision.spec.ts app-flow.spec.ts game.spec.ts keyboard-layout.spec.ts`
Expected: PASS. 토스트 문구를 기대하던 단언이 있으면 칸 아래 `role=alert`를 보도록 고친다.

- [ ] **Step 4: 온라인 E2E 전체를 실행한다**

Run: `npm --prefix frontend run test:e2e:online`
Expected: PASS(로컬 E2E·빌드와 동시에 실행하지 않는다).

- [ ] **Step 5: 커밋한다**

```bash
git add MULTIPLAYER_MODE.md ARCHITECTURE.md frontend/e2e
git commit -m "docs: describe the tabbed online entry and field errors"
```
