# 리팩토링 감사 — 멀티플레이 대비 책임 분리 검토

- 작성일: 2026-10-26
- 대상: `refactoring` 브랜치 (최신 커밋 `84a5374 docs: map repository architecture`)
- 기준 문서: [ARCHITECTURE.md](../../ARCHITECTURE.md), [frontend/src/README.md](../../frontend/src/README.md), [SYSTEM_SPEC.md](../../SYSTEM_SPEC.md), [UX_SPEC.md](../../UX_SPEC.md), [TECH_DECISIONS.md](../../TECH_DECISIONS.md)
- 상태: 검토 결과만 정리했다. 코드는 수정하지 않았다.

## 요약

- 의존 규칙은 import 기준으로 모두 지켜지고 있다.
  - `game/`은 외부 모듈을 import하지 않는다.
  - `features/gameplay`는 `local-game`·`pwa`를 import하지 않는다.
  - `features/pwa`는 `local-game`을 import하지 않는다.
  - `shared/`는 기능 폴더·게임 규칙을 import하지 않는다.
- `tsc --noEmit`은 통과했다. Vitest는 검토 환경(Linux VM + Windows용 `node_modules`) 문제로 실행하지 못했다. Windows에서 `npm.cmd --prefix frontend test -- --run`으로 확인이 필요하다.
- **폴더 구조의 큰 틀은 유지해도 된다.** 문제는 각 폴더 안의 내용이다. 화면 조립 코드와 일부 규칙이 아직 로컬 쪽이나 게임 상태 안에 있다. 이대로 멀티플레이를 붙이면 상당 부분을 복사하게 된다.

## 권장 진행 순서

1. **1 → 4 → 3 → 5**: 공통 화면과 모드 사이의 계약을 정하는 작업이라 먼저 한다.
2. **6~12**: 위 계약이 생긴 뒤에는 서로 독립적으로 진행할 수 있다.
3. **2 (`viewSeat`)**: 저장 형식·규칙이 바뀌는 변경이라 사용자 결정 후에 진행한다.
4. **🟢 항목**: 시간 날 때 정리한다.

---

## 🔴 멀티플레이 전에 필요한 변경

### 1. 게임 화면 조립이 `LocalGamePage`에 통째로 있음

- 위치: `frontend/src/features/local-game/LocalGamePage.tsx` 173~375행
- 문제:
  - 한 파일 안에 헤더, `Table`, 하단 독의 상태별 분기(setup/playing/ended/aborted), 대화상자 4개(지급 미리보기·관리 메뉴·기록·블라인드), 토스트, `bettingAction`의 UNDO 특수 처리가 모두 들어 있다.
  - 컴포넌트 단위는 공유되지만 조립 방식은 공유되지 않는다. 온라인 페이지를 만들면 이 부분을 그대로 복사하게 된다.
- 제안:
  - `features/gameplay/GameScreen.tsx`를 만든다.
  - 모드가 채워 넣는 계약은 `features/gameplay/session.ts`의 `GameSession` 하나로 정한다.
  - 예상 필드: `state`, `busy`, `capabilities`, `dispatch(command): Promise<boolean>`, `loadEvents(after, limit)`, `notify`, 오류·알림 영역 슬롯.
  - `LocalGamePage`에는 세션 생성, 복구 key, 홈, PWA, 로컬 오류 배너만 남긴다.
  - 토스트 상태·타이머는 `useToast`로 분리해 두 모드가 같이 쓴다.

### 2. `viewSeat`가 게임 상태 안에 있음 — 사용자 결정 필요

- 위치:
  - `frontend/src/game/settings.ts`의 `GameSettings.viewSeat`
  - `frontend/src/game/transition.ts`의 `SET_VIEW` 명령
  - UNDO의 `view` 보존 예외 처리
  - `frontend/src/features/local-game/hooks/useSetupEditing.ts`의 `rotate`
- 문제:
  - `viewSeat`는 화면에서 아래쪽에 올 좌석을 뜻하는 값이다. 그런데 게임 명령으로 처리되어 버전을 올리고 저장된다.
  - UX_SPEC 29행은 "로컬은 선택한 기준 좌석, 온라인은 자기 좌석을 아래쪽"으로 정한다. 온라인에서는 보는 사람마다 값이 달라야 하므로 서버의 공유 상태에 둘 수 없다.
- 제안:
  - 화면 쪽 상태로 옮긴다. 로컬은 별도로 저장하고, 온라인은 내 좌석에서 계산한다.
  - 저장 스키마, `storage/restore.ts`, `shared/game-fixtures`, 관련 E2E가 함께 바뀐다. 진행 여부를 먼저 결정해야 한다.

### 3. 베팅 입력 Hook이 허용 행동을 직접 계산함

- 위치: `frontend/src/features/gameplay/hooks/useBettingDraft.ts`
- 문제:
  - Hook 내부에서 `getLegalActions(state)`를 호출한다. 그런데 SYSTEM_SPEC 354행에 따르면 온라인은 서버가 "허용 행동 및 최소·최대 추가 금액"을 내려준다.
  - `submitAllowed`와 `prepareAction`의 CALL/ALL_IN/RAISE 분류(`legal.actor.B + draftAmount <= hand.W || legal.canRaise`)는 `transition`의 규칙을 UI에서 한 번 더 구현한 것이다.
- 제안:
  - `legal`을 인자로 받게 바꾼다. 로컬은 `getLegalActions` 결과를, 온라인은 서버 응답을 넘긴다.
  - 금액 분류는 `game/`에 함수 하나로 둔다. 예: `classifyDraft(legal, amount) → { command } | { errorCode }`. UI와 규칙 검증이 같은 함수를 쓴다.

### 4. 권한(capabilities) 개념이 없음

- 위치: `LocalGamePage.tsx`, `BetControls`, `SettlementPanel`, `GameHeader`, `Table`의 `busy`·`canUndo` props
- 문제:
  - 지금은 `busy`와 `!!s.undo`로만 조작을 막는다.
  - 온라인에는 "내 차례일 때만 베팅", "방장만 취소·정산·블라인드·준비 편집"(PLANNING 201·226행) 같은 구분이 필요하다.
- 제안:
  - `GameSession.capabilities`를 정의한다. 예상 필드: `canAct`, `canUndo`, `canSettle`, `canEditSetup`, `canEditBlinds`, `canManage`.
  - 로컬은 조작권이 있으면 모두 true로 둔다.
  - 온라인은 서버의 현재 상태(방장 여부, 본인 조작 권한, 허용 행동)에서 계산한다.

### 5. 거절 코드가 그대로 사용자에게 보임

- 위치:
  - `frontend/src/features/local-game/storage/repository.ts`: `MIN_RAISE`, `RAISE_CLOSED`, `STALE_STATE`, `SEQUENCE_GAP` 등을 반환
  - `frontend/src/features/local-game/hooks/useLocalSession.ts` 166행: `notify(result.reason)`
- 문제:
  - 코드를 한국어 문구로 바꾸는 대응표가 코드 어디에도 없다. 온라인 서버도 코드를 반환하므로 같은 문제가 반복된다.
  - 반대로 `validateSettings`와 `LegalActions.reason`은 한국어 문장을 반환한다. Java 서버와 동작을 맞추려면 이쪽도 코드가 낫다.
- 제안:
  - `game/errors.ts`에 코드 타입을 정의한다.
  - `features/gameplay/model/errorMessages.ts`에 코드→문구 대응표를 둔다.
  - 두 모드 모두 이 대응표를 통해 `notify`한다.

---

## 🟡 더 쪼개면 좋은 부분

### 6. `useLocalSession`(344행)에 책임이 섞여 있음

- 지금 섞여 있는 책임:
  - 저장소·컨트롤러 생성
  - BroadcastChannel probe/owner 프로토콜(207~224행)
  - `visibilitychange`·`pageshow`·`resume` 복귀 처리
  - 실행 잠금 `run`
  - 상태별 오류 문구
  - 브라우저 `confirm()` 창(137·246·252행)
- 제안:
  - `useCrossTabOwnership`과 `usePageResume`을 분리한다.
  - `confirm()`은 Hook 안에서 UI를 띄우는 것이므로 페이지로 옮긴다. Hook은 `confirm` 콜백을 주입받는다.
  - `run` 잠금은 온라인의 "응답 대기" 상태와 같은 패턴이다. 공통 `useCommandRunner`로 만들 수 있다.

### 7. `useSetupEditing`이 공통 로직인데 `local-game`에 있음

- 위치: `frontend/src/features/local-game/hooks/useSetupEditing.ts`
- 문제: 이 Hook은 `state`, `run`, `dispatch`만 사용한다. 드래그 순서 변경, 이름 검증, 딜러 지정, 시작은 온라인 대기방의 방장도 똑같이 한다(UX_SPEC 38행).
- 제안:
  - `features/gameplay/hooks/`로 옮긴다.
  - 인원 추가·삭제(`changeCount`)는 온라인에 없으므로 선택 기능으로 둔다.
  - scope 구성은 호출자가 넘긴다.

### 8. 칩 이동 계산에 공통 부분과 로컬 부분이 섞여 있음

- 위치: `frontend/src/features/local-game/model/localChipTransfers.ts`, `frontend/src/features/local-game/hooks/useLocalChipMotion.ts`
- 문제:
  - `chipTransfers`는 두 가지를 같이 한다. `transition`을 돌려 이벤트를 예측하는 부분(로컬 전용)과, 이벤트를 `ChipTransfer[]`로 바꾸는 부분(공통)이다.
  - 온라인은 서버가 확정한 이벤트를 받으므로 뒷부분만 필요하다.
- 제안:
  - `features/gameplay/model/eventTransfers.ts`에 `eventsToTransfers(events, commandType)`를 둔다.
  - 로컬에는 예측만 남긴다.
  - `document.hidden`과 `prefers-reduced-motion` 검사는 범용이므로 `useChipMotion`으로 옮긴다.

### 9. 기록 조회가 `LocalRepository`에 직접 묶여 있음

- 위치: `frontend/src/features/local-game/hooks/useLocalHistory.ts`, `frontend/src/features/local-game/components/LocalHistoryPanel.tsx`
- 제안:
  - 100개씩 읽는 반복을 `features/gameplay/hooks/useEventHistory(loadEvents)`로 일반화한다.
  - 로컬은 `repository.readEvents`를, 온라인은 REST 조회를 넘긴다.

### 10. 세 HTML 진입점이 모두 같은 `main.tsx`를 씀

- 위치: `frontend/index.html`, `frontend/local/index.html`, `frontend/online/index.html`, `frontend/src/app/App.tsx`, `frontend/vite.config.ts`
- 문제:
  - `App`이 경로를 보고 분기하고, `LocalGamePage`를 정적으로 import한다. 그래서 온라인 페이지 번들에도 IndexedDB 코드와 PWA 등록 코드가 들어간다.
  - precache 규칙 `assets/**/*.{js,css}`는 나중에 생길 온라인 청크까지 로컬 서비스 워커에 담게 된다.
- 제안:
  - 진입점을 `main.local.tsx`와 `main.online.tsx`로 분리한다. 각 HTML이 자기 진입점을 로드한다.
  - precache 대상은 로컬 진입점이 쓰는 청크로 좁힌다.

### 11. `transition.ts`(387행)가 명령 16개를 if/else 하나로 처리함

- 위치: `frontend/src/game/transition.ts`, `frontend/src/game/types.ts`
- 제안:
  - `game/commands/`에 `setup.ts`, `betting.ts`, `flow.ts`를 만들고, `transition`은 명령별 핸들러로 분배하는 역할만 맡는다.
  - `GameCommand`를 명령별로 필드가 정해진 판별 유니온으로 바꾼다. 지금은 선택 필드를 모아 둔 타입이라 `cmd.sb!`, `cmd.viewSeat!` 같은 단언이 반복된다. 판별 유니온은 Java 서버 DTO의 명세 역할도 한다.

### 12. 의존 규칙을 기계가 검사하지 않음

- 위치: `frontend/eslint.config.js`
- 문제: 경계 규칙은 문서(`ARCHITECTURE.md`, `frontend/src/README.md`)에만 있다.
- 제안: `no-restricted-imports` 또는 `eslint-plugin-boundaries`로 아래 규칙을 lint에 넣는다.
  - `game`은 다른 폴더를 import하지 않는다.
  - `gameplay`는 `local-game`·`online-game`·`pwa`를 import하지 않는다.
  - `shared`는 기능 폴더를 import하지 않는다.
  - `local-game`과 `online-game`은 서로 import하지 않는다.

---

## 🟢 작은 정리 거리

- **`BetControls`의 액션 타입**: `onAction(action: string)` 하나로 입력 조작(CHIP/CLEAR/DRAFT_ALL)과 게임 명령(CALL/FOLD/UNDO)이 섞여 있다. 타입 유니온으로 바꾸고, 취소는 별도 콜백으로 분리한다.
- **`Table` props 정리**:
  - 준비 편집용 props 7개(`onAdd`, `onRemove`, `onRotate`, `onRename`, `onNameEditing`, `editScope`, `drag`)를 `setup?: {...}` 하나로 묶는다.
  - 카드 글자 맞춤 루프는 `useFitText`로 분리한다.
  - `tableView.ts`가 핸드 시작 전 SB·BB 좌석을 직접 계산하는 부분은 `game/positions.ts`의 함수로 옮긴다.
- **이름 정리**:
  - `appReducer`는 Partial을 병합하기만 하므로 실제 동작에 맞는 이름(예: `mergeAppState`)으로 바꾸거나, 실제 액션 기반 리듀서로 만든다.
  - `shared/styles/tokens.css`에 전역 레이아웃(`.phone`, `dialog`, `.toast`, `.notice`, `.home`)이 섞여 있다. `tokens.css`와 `base.css`로 나눈다.
  - 저장소 루트 `shared/`(Java 서버와 공유할 fixture)와 `frontend/src/shared/`(범용 UI)는 이름이 같지만 의미가 다르다. 루트 쪽을 `contracts/` 같은 이름으로 바꾸는 걸 검토한다.
- **타입 위치**: `Request`, `ControlLease`, `DispatchResult`가 `repository.ts`에서 export되어 여러 곳에서 쓰인다. `storage/types.ts`로 옮긴다.
- **테스트 폴더명**: `frontend/tests/ui/`는 옛 구조 이름이다. 소스 구조에 맞춰 `tests/gameplay/`, `tests/local-game/`로 바꾼다.

---

## 목표 구조 (변경분만)

```
frontend/src/
  main.local.tsx / main.online.tsx        ← 진입점 분리 (10)
  game/
    commands/ setup.ts betting.ts flow.ts ← transition 분할 (11)
    errors.ts                             ← 오류 코드 정의 (5)
  features/
    gameplay/
      GameScreen.tsx                      ← 모드 공통 화면 조립 (1)
      session.ts                          ← GameSession·Capabilities 계약 (1, 4)
      hooks/ useSetupEditing.ts useEventHistory.ts useToast.ts   ← 이동·신규 (7, 9, 1)
      model/ errorMessages.ts eventTransfers.ts                  ← (5, 8)
    local-game/
      LocalGamePage.tsx                   ← 세션·복구·홈·PWA + GameSession 연결만
      hooks/ useLocalSession useCrossTabOwnership usePageResume  ← (6)
    online-game/                          ← 나중에 추가: OnlineGamePage, api/, socket/, useOnlineSession
```

## Claude Code에서 이어서 작업할 때

```
ARCHITECTURE.md와 docs/reviews/2026-10-26-refactoring-audit.md를 먼저 읽어줘.
refactoring 브랜치에서 감사 결과의 1 → 4 → 3 → 5 순서로 진행할 거야.
각 항목마다 계획을 먼저 보여주고, 테스트 통과 후 AGENTS.md 규칙대로 커밋해줘.
2번(viewSeat)은 내가 결정하기 전까지 손대지 마.
```
