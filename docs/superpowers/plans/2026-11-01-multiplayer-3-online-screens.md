# 멀티플레이 계획 3: 온라인 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자가 각자 휴대폰의 `/online/`에서 방을 만들거나 들어가, 끊김과 복구를 겪어도 한 토너먼트를 끝까지 진행할 수 있는 화면을 완성한다.

**Architecture:** 새 `features/online-game`이 서버 계약 변환, 통신, 재연결, 권한 표시를 맡고 기존 `GameScreen`에는 `GameSession`만 넘긴다. React를 모르는 `OnlineController`가 요청·조작권·연결 상태를 소유하고, 화면은 그 스냅샷을 구독한다. 서버 확정 상태만 표시하며 대기방은 준비 단계 `GameState`로 변환해 같은 화면을 쓴다.

**Tech Stack:** React 19, TypeScript 6, Vite 8, 브라우저 `fetch`·`WebSocket`(통신 라이브러리 없음), Vitest 5, Playwright 1.64 + 실제 Spring 서버.

**Spec:** [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 3~13·15·16절, [SYSTEM_SPEC.md](../../../SYSTEM_SPEC.md) 6·8·10·14·15절, [shared/api-contract/README.md](../../../shared/api-contract/README.md), TECH_DECISIONS T53·T54·T69·T71~T75, [계획 2B](2026-10-31-multiplayer-2b-realtime-and-lifecycle.md)의 "계획 3으로 넘기는 항목".

## 범위

| 포함 | 제외 |
|---|---|
| C06 온라인 화면, C07의 화면 부분(기권·중단·다시 준비), 복구·인수·끊김 화면, 앱 홈 진입, manifest scope, TS 계약 검사, 온라인 E2E | 요청 빈도 제한, 서버 배포, CI에 온라인 E2E 편입, 실기기·부하 측정, 배포 게이트 안내(계획 4) |

## 이번에 확정한 결정 (2026-11-01 사용자 확정)

- 온라인 브라우저 테스트는 실제 Spring 서버를 상대로 실행한다.
- 대기방은 전용 화면을 만들지 않고 기존 `GameScreen`을 재사용한다.

계획 작성 중 다음 사항도 정했다.

- **통신:** `fetch`와 브라우저 `WebSocket`을 직접 쓴다. T44 범위에 라이브러리가 필요한 기능이 없다.
- **화면 식별:** 탭마다 `sessionStorage`에 `{roomId}`를 둔다. 표시가 있는 탭의 새로고침은 자동으로 `/control`을 호출해 새 세대의 순번 1부터 시작한다. 표시가 없는 새 탭은 보기만 하고 `이 화면에서 이어하기`를 눌러야 조작한다. 순번은 저장하지 않으므로 어긋날 수 없다.
- **복귀 안내:** `localStorage`에는 마지막 `{roomId, code}`만 둔다. 인증값은 넣지 않는다.
- **방 소실:** REST에 410을 추가하지 않는다. 자리가 있던 방의 404는 상태 조회로 확인해 소실 화면으로 보낸다.
- **E2E 방 한도:** 진행 중 방은 30분 남으므로, 서버에 기본값 10인 `poker.max-rooms` 설정을 추가하고 `e2e` 프로파일에서만 200으로 올린다.
- **온라인 E2E 분리:** 별도 설정 `playwright.online.config.ts`와 `test:e2e:online`을 쓴다. 기존 E2E 시간과 CI는 그대로다.
- **기권 처리 진입:** 명세의 두 경로 중 관리 메뉴만 만든다. 카드 길게 누르기는 좌석 드래그 입력과 겹치므로 넣지 않는다.

## Global Constraints

- 서버 응답 또는 더 높은 버전의 상태를 받기 전에는 잔액·팟을 바꾸지 않고 버튼을 막는다. 낙관적 반영과 규칙 예측을 하지 않는다.
- SNAPSHOT 적용: `(stateVersion, draftVersion)`이 낮으면 버린다. 같은 쌍은 `previousVersion`이 `null`일 때만 효과 없이 적용한다. 다른 `tournamentId`의 상태는 버전 숫자로 비교하지 않고 받은 쪽을 적용한다. 효과는 `previousVersion`이 화면 버전과 같을 때만 재생한다.
- 재연결 간격: 1·2·4·8·최대 15초, 지터 포함. 15초 PING에는 PONG으로 답하고, PING의 `stateVersion`이 화면보다 높으면 RESYNC를 보낸다.
- 재연결 여부는 종료 코드가 아니라 마지막 메시지(`ACCESS_REVOKED`·`ROOM_GONE`·`PROTOCOL_INCOMPATIBLE`) 수신 여부로 정한다. 마지막 메시지를 받으면 재연결하지 않는다.
- 끊긴 동안 행동을 쌓지 않는다. 결과를 모르는 요청 하나만 같은 requestId·순번·본문으로 확인하고 재전송한다. 새 요청으로 바꾸지 않는다.
- 세션 갱신: 활성 화면에서 6시간마다, 그리고 화면 복귀 시 `POST /api/session/refresh`를 호출한다. CSRF 토큰은 메모리에만 둔다.
- 복구 결과 조회는 3초 간격이다. 대기방의 첫 연결 대기 30초가 승인 시각부터 시작하기 때문이다.
- `/online/`은 서비스 워커가 제어하지 않는다. manifest는 `scope: "/"`로 넓히고 `start_url`·`id`는 `/local/`을 유지한다. 앱 홈에서 `/online/`으로는 문서 탐색으로 이동한다.
- 공통 화면은 `GameSession`과 props로만 받는다. `features/gameplay`는 온라인 코드를 import하지 않고, `online-game`은 `local-game`을 import하지 않는다.
- 기존 로컬 동작은 바뀌지 않는다. 새 공통 props는 모두 선택값이고 기본 동작은 지금과 같다.
- 화면 문구는 명세 문구를 그대로 쓴다: `OO 차례입니다`, `방장이 승자를 선택하고 있습니다`, `방장이 다음 게임을 준비하고 있습니다`, `방장만 취소할 수 있습니다`, `이 화면에서 이어하기`, `기존 참가자로 복구`, `방장 맡기`, `다시 준비하기`.
- 새 함수·컴포넌트·클래스와 테스트 함수(`it`·`test`) 위에는 역할을 설명하는 한글 주석을 한 줄 둔다. 리뷰에서 누락이 지적되면 미루지 않고 그 작업에서 고친다.
- 작업마다 관련 검증 후 로컬 커밋한다. push·PR은 별도 요청이 있을 때만 한다.

## Review Focus

1. **응답을 잃은 베팅:** 전송 뒤 응답이 끊겨도 칩이 두 번 빠지면 안 되고, 재연결 뒤 같은 요청의 결과를 확인해야 한다. → Task 4 `OnlineController` 테스트.
2. **혼자 있는 방:** 2명 미만이면 `validateSettings`가 이름 오류를 내므로, 혼자 있는 방장의 이름·칩 변경이 막히면 안 된다. → Task 7 E2E.
3. **휴대폰 잠금 후 복귀:** 소켓이 조용히 죽은 채 화면으로 돌아와도 조작이 막히고 즉시 재연결해야 한다. → Task 3 `visibilitychange` 테스트, Task 10.
4. **탭 두 개:** 같은 브라우저의 새 탭은 보기만 가능하고, 인수하면 이전 탭 버튼이 곧바로 막혀야 한다. → Task 10 E2E.
5. **차례가 온 순간의 새로고침:** 서버가 자동 처리해도 화면은 멈추지 않고 최신 상태로 돌아와야 하며, 입력 초안이 새 상태에 잘못 남으면 안 된다. → Task 10 E2E.

---

### Task 1: 실제 서버 E2E 환경

**Files:**
- Modify: `backend/server/.../registry/RoomRegistry.java`, `backend/server/src/main/resources/application.yaml` (`poker.max-rooms: 10`, 프로파일 `e2e`의 값 200과 `http://127.0.0.1:4174` 허용)
- Modify: `frontend/vite.config.ts` (`server.proxy`·`preview.proxy`에 `/api`, `/ws`. 대상은 `http://127.0.0.1:8080`, `/ws`는 `ws: true`)
- Create: `frontend/playwright.online.config.ts`, `frontend/e2e/online/support.ts`, `frontend/e2e/online/smoke.spec.ts`
- Modify: `frontend/package.json` (`test:e2e:online`)
- Test: `backend/server/.../registry/RoomRegistryTest.java`

**Interfaces:**
- Produces: `newParticipant(browser): Promise<Page>`(새 컨텍스트로 `/online/`을 연다), `playwright.online.config.ts`의 포트 4174와 백엔드 8080. `testDir`는 `e2e/online`, 프로젝트는 `chromium`·`webkit`, `webServer`는 백엔드(`gradlew :server:bootRun --args=--spring.profiles.active=e2e`, `/api/health` 대기)와 프런트(`vite build` 후 preview) 두 개다.

- [x] **Step 1: 실패 테스트 작성** `RoomRegistryTest`: 한도를 3으로 주면 4번째 생성이 `ROOM_LIMIT`이고, 기본 생성자의 한도는 10이다. `smoke.spec.ts`: 페이지 안에서 `/api/health`가 200이고 `protocolVersion`이 1이다. `/ws`가 세션 없이 열리지 않는다.
- [x] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*RoomRegistryTest*'` / Expected: FAIL
- [x] **Step 3: 구현** `MAX_ROOMS` 상수를 기본값으로 남기고 생성자에 한도를 받는다.
- [x] **Step 4: 통과 확인** Run: `backend/gradlew -p backend test` 그리고 `npm --prefix frontend run test:e2e:online` / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "test(online): run browser tests against the real server"`

### Task 2: 서버 계약 타입과 변환

**Files:**
- Create: `frontend/src/features/online-game/api/types.ts`, `.../model/toGameState.ts`, `.../model/toServerCommands.ts`
- Modify: `frontend/src/game/types.ts` (`Player.forfeited?: boolean`, 이벤트 상세의 `auto?`·`byHost?`), `frontend/src/features/gameplay/model/errorMessages.ts`, `frontend/src/features/gameplay/session.ts`
- Test: `frontend/tests/online-game/contract.test.ts`, `toGameState.test.ts`, `toServerCommands.test.ts`

**Interfaces:**
- Produces:
  - `RoomSnapshot`, `SnapshotMessage`, `CommandResponse`, `JoinResponse`, `RecoveryStatus` 타입
  - `toGameState(snapshot: RoomSnapshot): GameState`: `game`이 있으면 그대로 쓴다. `null`이면 `status: 'setup'`, 플레이어 `id`는 participantId, 이름은 명단 순서, 칩은 `settings.initial`, `settings.button`은 서버 값인 상태를 만든다.
  - `viewSeatOf(snapshot): number`: 게임이 있으면 `you`의 `playerId` 위치, 없으면 명단 좌석이다.
  - `toServerCommands(command: GameCommand, snapshot: RoomSnapshot): ServerCommand[]`: `START_TOURNAMENT`→`START`, 베팅과 `UNDO`·`ABORT`·`SCHEDULE_BLINDS`·`SETTLE_HAND`는 같은 이름이다. `SETUP_UPDATE`는 현재 값과 비교해 순서대로 `SET_SEAT_ORDER`, `SET_DEALER`, `SET_SETTINGS`, `RENAME`으로 나눈다. 바뀐 것이 없으면 빈 배열이다.
  - `ServerCommand = { type: string; payload?: object; handScoped: boolean }`. `handScoped`는 베팅 6종과 `SETTLE_HAND`, `SETTLEMENT_DRAFT`에서 참이다.
  - `errorMessages`에 서버 코드 추가: `NOT_YOUR_TURN`, `NOT_WAITING`, `NO_DEALER`, `NOT_CONNECTED`, `PLAYER_COUNT`, `ROOM_FULL`, `ROOM_NOT_FOUND`, `ROOM_LIMIT`, `INVALID_NAME`, `DUPLICATE_NAME`, `TRANSFER_HOST_FIRST`, `ABORT_FIRST`, `TARGET_CONNECTED`, `HOST_TAKEOVER_CLOSED`, `RECOVERY_LIMIT`, `RECOVERY_NOT_PENDING`, `RECOVERY_TARGET_NOT_FOUND`, `ALREADY_PARTICIPANT`, `FORBIDDEN`.

- [x] **Step 1: 실패 테스트 작성**
  - `contract.test.ts`: `shared/api-contract`의 `snapshot-*`, `ws-snapshot`, `create-room`, `command-applied`, `recovery-approved`를 읽어 타입 가드를 통과하고, `toGameState`가 `validateStored`와 같은 규칙의 칩 총량 검사를 통과한다.
  - `toGameState.test.ts`: 대기방 예시에서 `status`가 `setup`, 인원과 이름이 명단과 같고 딜러 미지정이 -1이다. 진행 예시에서 `undo`와 `pending`이 유지된다. `viewSeatOf`가 자기 좌석이다.
  - `toServerCommands.test.ts`: 드래그 저장은 `SET_SEAT_ORDER` 하나다. 금액 변경은 `SET_SETTINGS` 하나다. 이름 변경은 `RENAME` 하나다. 같은 값은 빈 배열이다. `BET`의 payload는 `{additional}`이고 `playerId`를 보내지 않는다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend test -- --run tests/online-game` / Expected: FAIL
- [x] **Step 3: 구현** 서버 이름과 TS 이름이 같으므로 게임 상태는 복사만 한다.
- [x] **Step 4: 통과 확인** Run: `npm --prefix frontend test -- --run` 그리고 `npm --prefix frontend run typecheck` / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): map the server contract to the game screen"`

### Task 3: REST 클라이언트와 소켓 연결

**Files:**
- Create: `frontend/src/features/online-game/api/client.ts`, `.../realtime/roomSocket.ts`
- Test: `frontend/tests/online-game/client.test.ts`, `roomSocket.test.ts`

**Interfaces:**
- Produces:
  - `class ApiClient`: `open(): Promise<void>`(세션과 스트림 준비), `refresh()`, `closeStream()`(`fetch`의 `keepalive`), `post(path, body)`, `get(path)`. 결과는 `{ ok: true; status; body } | { ok: false; status; code; body } | { ok: false; unknown: true }`이고, 네트워크 오류나 5xx는 `unknown`이다. CSRF 403이면 토큰을 다시 받아 한 번만 재시도한다.
  - `class RoomSocket(url, handlers)`: `subscribe(roomId, lastSeenVersion)`, `resync()`, `close()`, `state: 'connecting' | 'open' | 'waiting'`. handlers는 `onSnapshot`, `onFinal(type)`, `onPing(stateVersion)`, `onState`다. 지연 함수 `reconnectDelay(attempt, random): number`는 1·2·4·8·15초에 ±20% 지터를 준다.

- [x] **Step 1: 실패 테스트 작성** (`vi.useFakeTimers`, 가짜 `WebSocket`, 가짜 `fetch`)
  - `client.test.ts`: 변경 요청에 `X-CSRF-TOKEN`이 붙는다. CSRF 403은 토큰을 새로 받아 한 번 재시도한다. 네트워크 오류는 `unknown`이고 자동 재전송하지 않는다.
  - `roomSocket.test.ts`: 연결되면 SUBSCRIBE를 보낸다. PING에 같은 nonce로 PONG을 보낸다. 끊기면 지연 뒤 다시 연결하고 다시 구독한다. 마지막 메시지 뒤에는 어떤 종료 코드로 닫혀도 재연결하지 않는다. 마지막 메시지 없이 1000으로 닫히면 재연결한다. 45초 동안 PING이 없으면 스스로 닫고 재연결한다. `visibilitychange`로 돌아오면 대기 없이 재연결한다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend test -- --run tests/online-game` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** 같은 명령 / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): add the REST client and the room socket"`

### Task 4: OnlineController

**Files:**
- Create: `frontend/src/features/online-game/session/onlineController.ts`
- Test: `frontend/tests/online-game/onlineController.test.ts`

**Interfaces:**
- Consumes: Task 2 변환, Task 3 `ApiClient`·`RoomSocket`. 둘 다 생성자로 주입한다.
- Produces:
  - `subscribe(listener)`, `getView(): OnlineView`. `OnlineView = { phase: 'entry' | 'joining' | 'recovering' | 'room' | 'gone' | 'revoked' | 'incompatible'; snapshot: RoomSnapshot | null; connection: 'online' | 'syncing' | 'offline'; hasControl: boolean; pending: boolean; recovery: RecoveryStatus | null; error: string | null }`
  - `create(name)`, `join(code, name)`, `requestRecovery(code, name)`, `resume()`
  - `send(commands: ServerCommand[]): Promise<boolean>`, `sendDraft(potIndex, winners)`, `takeControl()`, `leaveRoomScreen()`, `retry()`
  - `onConfirmed(listener)`: 효과 재생 조건을 통과한 `{ events, previous, next }`를 알린다.

규칙:
- 요청은 한 번에 하나다. `send`의 명령 목록은 앞이 실패하면 멈춘다. 각 요청은 `requestId`(UUID), 세대별 `sequence`, 최신 `expectedStateVersion`을 담는다.
- `unknown` 결과는 요청을 보관하고 `pending`을 유지한다. 재연결 뒤 `GET requests/{id}`로 확인한다. 있으면 그 결과를 쓰고, `REQUEST_NOT_FOUND`면 같은 본문으로 다시 보낸다.
- 거절이면 `latestState`가 있을 때 적용하고 `messageFor(code)`를 돌려준다. `CONTROL_LOST`면 `hasControl`을 끈다. `SEQUENCE_GAP`·`REQUEST_CONFLICT`·`RESULT_EXPIRED`는 RESYNC 후 `/control`로 새 세대를 받는다.
- `sendDraft`는 화면을 잠그지 않는다. 진행 중이면 최신 선택 하나만 남겨 이어서 보낸다. 일반 명령은 대기 중인 초안 뒤에 간다.
- 스냅샷의 `you.controlGeneration`이 자기 세대보다 크면 `hasControl`을 끈다.
- 탭 표시가 있으면 `resume`에서 `/control`로 세대를 받고, 없으면 보기 모드로 구독한다.
- `busy`에 해당하는 `pending || connection !== 'online' || !hasControl`이면 화면이 조작을 막는다.

- [x] **Step 1: 실패 테스트 작성**
  - 응답을 잃은 요청은 재연결 뒤 결과를 조회하고, 있으면 다시 보내지 않는다. 없으면 같은 requestId·sequence·본문으로 보낸다.
  - 결과를 모르는 동안 다른 `send`는 거절된다.
  - 낮은 버전 SNAPSHOT은 무시하고, 같은 버전의 `previousVersion: null`은 적용하며 효과는 없다. 연속 버전은 효과를 알린다. 건너뛴 버전은 상태만 적용한다.
  - 새 `tournamentId`의 상태는 숫자가 낮아도 적용한다.
  - `STALE_STATE`는 최신 상태를 적용하고 false를 돌려준다.
  - 초안 3개를 연달아 보내면 첫 번째와 마지막만 전송된다.
  - 다른 화면의 인수로 세대가 오르면 `hasControl`이 꺼지고 `takeControl` 뒤 순번이 1부터다.
  - 탭 표시 없이 시작하면 조작할 수 없다.
  - `ROOM_GONE`·`ACCESS_REVOKED`·`PROTOCOL_INCOMPATIBLE`이 각 phase로 바뀌고 재연결을 멈춘다.
  - 승인된 복구 결과에서 `room`으로 넘어가고 세대가 응답값이다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend test -- --run tests/online-game/onlineController` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** 같은 명령 / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): add the online session controller"`

### Task 5: 공통 화면 확장

**Files:**
- Modify: `frontend/src/features/gameplay/session.ts`, `GameScreen.tsx`, `components/Table.tsx`, `components/PlayerSeat.tsx`, `model/tableView.ts`, `hooks/useSettlementSelection.ts`, `model/history.ts`, `model/eventTransfers.ts`, `styles/table.css`
- Test: `frontend/tests/gameplay/` 아래 기존 파일과 `gameScreenOnline.test.tsx`

**Interfaces:**
- Produces: `GameSession`의 선택 필드
  - `canRename?: (id: string) => boolean`: 없으면 `canEditSetup`
  - `disconnectedIds?: ReadonlySet<string>`: 카드에 끊김 표시
  - `dockNotice?: string | null`: 베팅 버튼 위 안내(`OO 차례입니다` 등). 하단 높이를 바꾸지 않는다.
  - `denied?: (need: keyof GameCapabilities) => string`: 없으면 기존 `조작 권한이 없습니다.`
  - `sharedSelection?: { winners: WinnerSelection; potIndex: number } | null`, `onSelectionChange?: (selection) => void`
  - `resultActions?: ReactNode`: 결과 하단 슬롯
- `historyRows`: `details.auto`면 `OO - 폴드(자동)`처럼 표시한다. `FORFEIT`은 `OO - 기권`, `byHost`면 `OO - 기권(방장 처리)`, `FORFEIT_SPLIT`은 `OO - 기권 칩 N칩 획득`이다.
- `eventsToTransfers`의 `commandType`을 선택값으로 바꾼다. 없으면 이벤트에서 판별한다.

- [x] **Step 1: 실패 테스트 작성**
  - `canRename`이 있으면 해당 카드에서만 이름 편집이 열린다.
  - 끊긴 카드에 표시가 붙는다.
  - `sharedSelection`이 있으면 승자 강조와 팟이 그 값을 따르고, 방장의 탭은 `onSelectionChange`를 호출한다.
  - 흐린 버튼을 누르면 `denied` 문구가 나온다.
  - `historyRows`의 새 네 문구, 취소에 포함된 자동 행동이 숨겨지는 것을 검사한다.
  - 새 필드가 없을 때 기존 테스트가 모두 그대로 통과한다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend test -- --run tests/gameplay` / Expected: FAIL
- [x] **Step 3: 구현** 위 인터페이스대로 구현한다. `useSettlementSelection`은 외부 값이 있으면 내부 초안 대신 그 값을 쓴다.
- [x] **Step 4: 통과 확인** Run: `npm --prefix frontend run lint`, `npm --prefix frontend test -- --run`, `npm --prefix frontend run test:e2e -- e2e/game.spec.ts e2e/app-flow.spec.ts` / Expected: PASS, 스크린샷 변화 없음
- [x] **Step 5: 커밋** `git commit -m "feat(gameplay): let a mode share selections and show presence"`

### Task 6: 입장 화면과 진입 경로

**Files:**
- Create: `frontend/src/features/online-game/OnlineApp.tsx`, `components/OnlineEntry.tsx`, `components/OnlineFatal.tsx`, `hooks/useOnlineController.ts`, `styles/online.css`
- Modify: `frontend/src/main.online.tsx`, `frontend/src/features/local-game/components/LocalHome.tsx`, `frontend/public/local/manifest.webmanifest`
- Delete: `frontend/src/app/OnlinePlaceholder.tsx`
- Test: `frontend/tests/online-game/onlineEntry.test.tsx`, `frontend/e2e/online/entry.spec.ts`, `frontend/e2e/entry-routes.spec.ts`, `frontend/e2e/pwa.spec.ts`

**Interfaces:**
- Consumes: Task 4 `OnlineController`.
- Produces: `useOnlineController(): { view: OnlineView; controller: OnlineController }`(`useSyncExternalStore`), `OnlineApp`이 `view.phase`로 화면을 고른다. `RoomPage`는 Task 7에서 만들며 이 작업에서는 방 코드를 보여 주는 최소 화면이다.

규칙: 입력은 `방 만들기`(이름), `방 참가`(코드·이름), `기존 참가자로 복구`(코드·이름)다. 초대 링크 `/online/?code=ABC234`면 코드를 채운다. 소문자도 허용한다. 저장된 방이 있으면 먼저 복귀를 시도하고, 실패하면 입장 화면으로 돌아가 저장값을 지운다. 복구 신청 뒤에는 `방장의 승인을 기다리고 있습니다`를 표시하고 3초마다 조회하며, `REJECTED`·`EXPIRED`·`SUPERSEDED`는 이유를 보여 준 뒤 입장 화면으로 돌아간다. 오프라인이면 연결이 필요하다는 안내만 한다. `OnlineFatal`은 방 소실·권한 회수·새로고침 필요 안내를 보여 준다. 앱 홈의 `멀티플레이 모드`는 `location.assign('/online/')`이다.

- [x] **Step 1: 실패 테스트 작성**
  - `onlineEntry.test.tsx`: 링크의 코드가 채워진다. 잘못된 이름의 거절 문구가 나온다. 복구 상태별 문구가 나온다.
  - `entry.spec.ts`(실제 서버): 방 만들기 뒤 방 코드가 보인다. 두 번째 컨텍스트가 소문자 코드로 참가한다. 없는 코드의 안내가 나온다. 앱 홈 버튼이 문서 탐색으로 `/online/`에 도착한다.
  - `entry-routes.spec.ts`·`pwa.spec.ts`: manifest `scope`가 `/`, `start_url`·`id`가 `/local/`이고 `/online/`이 서비스 워커 제어 밖이며 `online-` 청크가 precache에 없다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend test -- --run tests/online-game/onlineEntry` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** Run: `npm --prefix frontend run test:e2e:online -- entry` 그리고 `npm --prefix frontend run test:e2e -- e2e/entry-routes.spec.ts e2e/pwa.spec.ts` / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): add the entry screen and enable the online route"`

### Task 7: 대기방과 진행 화면 연결

**Files:**
- Create: `frontend/src/features/online-game/RoomPage.tsx`, `hooks/useOnlineGameSession.ts`, `model/onlineNotices.ts`, `components/WaitingBar.tsx`, `components/ConnectionBanner.tsx`
- Test: `frontend/tests/online-game/onlineNotices.test.ts`, `frontend/e2e/online/waiting-room.spec.ts`, `frontend/e2e/online/betting.spec.ts`

**Interfaces:**
- Consumes: Task 2 변환, Task 4 컨트롤러, Task 5 `GameSession` 필드, 기존 `useSetupEditing`.
- Produces: `useOnlineGameSession(view, controller): { session: GameSession; setup: SetupControls }`, `dockNoticeFor(snapshot, viewerId): string | null`.

규칙:
- `session.dispatch`는 `toServerCommands`로 바꿔 `controller.send`를 호출한다. `legal`, `capabilities`는 스냅샷 값을 그대로 쓴다. `scope`는 조작 세대다. `guard`는 끊김이면 `연결이 끊겼습니다`, 조작권 상실이면 `다른 화면에서 조작 중입니다.`, 처리 중이면 `서버 응답을 기다려주세요.`를 돌려준다.
- `viewSeat`는 `viewSeatOf`다. `setup.rotate`, `changeCount`는 넘기지 않는다.
- `canRename`은 대기방의 본인 카드만 참이다. `setup.rename`은 `validateSettings`를 거치지 않고 `RENAME`을 보낸다. 서버가 이름을 검증하고, 혼자인 방도 동작해야 하기 때문이다. 같은 이유로 혼자인 방의 금액 저장도 이름 검사를 통과하도록 온라인 쪽에서 처리한다.
- 대기방 상단 `WaitingBar`에 방 코드와 초대 링크 복사를 둔다. 비방장에게 설정은 읽기 전용이다.
- `ConnectionBanner`는 `재연결 중`과 수동 `다시 연결` 버튼, 조작권 상실 때 `이 화면에서 이어하기`를 보여 준다.
- `loadEvents`는 `GET history`를 쓰고 410이면 빈 목록을 돌려준다.

- [x] **Step 1: 실패 테스트 작성**
  - `onlineNotices.test.ts`: 남의 차례면 `OO 차례입니다`, 내 차례면 null, 정산 중 비방장은 `방장이 승자를 선택하고 있습니다`와 선택 인원, 결과 화면 비방장은 `방장이 다음 게임을 준비하고 있습니다`다.
  - `waiting-room.spec.ts`(참가자 3명): 혼자인 방장이 이름과 칩을 바꿀 수 있다. 참가자가 들어오면 모든 화면에 카드가 늘어난다. 각자 자기 카드가 맨 아래다. 본인만 자기 이름을 바꿀 수 있다. 방장의 좌석 드래그와 딜러 지정이 모두에게 반영된다. 딜러가 없으면 시작할 수 없다.
  - `betting.spec.ts`: 시작 뒤 행동자에게만 버튼이 켜진다. 다른 사람은 `OO 차례입니다`를 본다. 콜 0에서 폴드가 흐리게 표시된다. 베팅이 모든 화면에 같은 잔액으로 반영된다. 차례가 아닌 사람이 흐린 버튼을 누르면 `내 차례가 아닙니다`가 나온다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend run test:e2e:online -- waiting-room betting` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** 같은 명령과 `npm --prefix frontend run lint` / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): play from the waiting room through betting"`

### Task 8: 정산 공유·효과·알림

**Files:**
- Create: `frontend/src/features/online-game/hooks/useOnlineChipMotion.ts`, `model/eventNotices.ts`
- Modify: `frontend/src/features/online-game/RoomPage.tsx`, `hooks/useOnlineGameSession.ts`, `session/onlineController.ts`
- Test: `frontend/tests/online-game/eventNotices.test.ts`, `frontend/e2e/online/settlement.spec.ts`

**Interfaces:**
- Consumes: Task 4 `onConfirmed`, `sendDraft`, Task 5 `sharedSelection`, 기존 `useChipMotion`, `eventsToTransfers`.
- Produces: `noticesFor(events, known): string[]`. `known`은 컨트롤러가 최근 이벤트 200개를 id로 보관한 표다.

규칙: `sharedSelection`은 스냅샷의 `settlementDraft`다. 방장의 선택 변경은 낙관적으로 표시하고 `sendDraft`로 보낸다. 초안은 칩을 옮기지 않으므로 Global Constraints의 낙관적 반영 금지 대상이 아니다. 방장은 받은 초안이 자기 마지막 전송보다 오래됐으면 무시한다. UNDO 이벤트를 받으면 `resetSelection`과 베팅 초안을 버린다. 취소 알림은 `방장이 OO의 콜 50을 취소했습니다`이고, 대상 이벤트를 모르면 `방장이 직전 행동을 취소했습니다`다. 자동 행동은 `OO - 폴드(자동)`을 짧게 알린다. 칩 이동은 `onConfirmed`의 이벤트로만 재생한다.

- [x] **Step 1: 실패 테스트 작성**
  - `eventNotices.test.ts`: 취소 문구 두 형태, 자동 체크·폴드 문구, 일반 행동은 문구 없음을 검사한다.
  - `settlement.spec.ts`: 방장의 승자 선택과 팟 이동이 다른 화면에 보인다. 방장이 새로고침해도 선택이 남는다. WIN 하나로 다음 핸드 블라인드까지 반영된다. 단독 자격 팟은 자동 선택이다. 취소하면 모든 화면에 문구가 나오고 선택이 사라진다. 방장 아닌 사람의 `취소`를 누르면 `방장만 취소할 수 있습니다`가 나온다. 칩 이동 요소가 다른 화면에서도 나타난다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend run test:e2e:online -- settlement` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** 같은 명령 / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): share settlement picks and play confirmed effects"`

### Task 9: 관리 메뉴·방장 인수·복구 승인·결과

**Files:**
- Create: `frontend/src/features/online-game/components/OnlineMenu.tsx`, `HostRequests.tsx`, `ResultActions.tsx`
- Modify: `frontend/src/features/online-game/RoomPage.tsx`
- Test: `frontend/tests/online-game/onlineMenu.test.tsx`, `frontend/e2e/online/host-tools.spec.ts`, `frontend/e2e/online/recovery.spec.ts`, `frontend/e2e/online/result.spec.ts`

**Interfaces:**
- Consumes: Task 4 `send`, 스냅샷의 `hostTakeoverOpen`, `you.canTakeHost`, `recoveryRequests`.
- Produces: `menuItems(snapshot, connectedIds): MenuItem[]`.

규칙: 메뉴 표는 MULTIPLAYER_MODE 7절의 항목·대상·조건 그대로다. `앱 홈`, `방 나가기`, `기권 처리`, `기권`, `방장 넘기기`, `참가자 내보내기`, `토너먼트 중단`, `다시 준비하기`를 조건에 맞게 표시한다. 확인창이 필요한 항목은 공통 `Dialog`로 명세 문구를 보여 준다. 방장의 기권은 `먼저 방장을 넘겨주세요`를 안내한다. `HostRequests`는 복구 신청과 `방장 맡기`를 화면 안에 계속 표시한다. 팝업이 아니므로 새로고침해도 스냅샷에서 다시 보인다. 복구 승인은 방장에게 대상 이름·신청 시각을 보여 주고 실제 사람을 확인하라고 안내한다. 결과 화면 한 줄 요약은 기존 공통 화면을 쓰고, `forfeited`인 사람의 카드는 탈락처럼 표시한다.

- [x] **Step 1: 실패 테스트 작성**
  - `onlineMenu.test.tsx`: 역할·단계별 메뉴 항목 표(방장·참가자 × 대기·진행·결과)를 검사한다. 끊긴 사람이 없으면 `기권 처리`가 없다.
  - `host-tools.spec.ts`: 내보내기, 방장 넘기기, 본인 기권과 칩 분배 표시, 끊긴 사람 기권 처리, 방장 60초 끊김 뒤 `방장 맡기`.
  - `recovery.spec.ts`: 새 컨텍스트로 복구 신청, 방장 화면에 표시, 승인 뒤 자리·칩 유지, 옛 화면이 권한 회수 안내로 바뀜, 거절 안내.
  - `result.spec.ts`: 토너먼트 중단 요약, 정상 종료 요약, 결과에서 취소, `다시 준비하기` 뒤 대기방으로 복귀하고 이름·좌석이 유지되며 시작 설정이 돌아오고 딜러가 비어 있음.
  - 60초 시험은 `e2e` 프로파일에서도 실제 시간을 쓴다. `test.slow()`로 표시한다.
- [x] **Step 2: 실패 확인** Run: `npm --prefix frontend run test:e2e:online -- host-tools recovery result` / Expected: FAIL
- [x] **Step 3: 구현** 위 규칙대로 구현한다.
- [x] **Step 4: 통과 확인** 같은 명령 / Expected: PASS
- [x] **Step 5: 커밋** `git commit -m "feat(online): add the host tools, recovery and result actions"`

### Task 10: 끊김 시나리오·전체 흐름·문서

**Files:**
- Create: `frontend/e2e/online/reconnect.spec.ts`, `frontend/e2e/online/two-tabs.spec.ts`, `frontend/e2e/online/full-tournament.spec.ts`
- Modify: `frontend/DEVICE_CHECKS.md`, `ARCHITECTURE.md`, `MULTIPLAYER_MODE.md`, `TECH_DECISIONS.md`, `IMPLEMENTATION_PROGRESS.md`, `frontend/src/README.md`, `shared/api-contract/README.md`

- [x] **Step 1: 시나리오 테스트 작성**
  - `reconnect.spec.ts`: `context.setOffline`으로 끊으면 화면이 `재연결 중`이고 버튼이 막힌다. 복귀하면 최신 상태로 맞고 조작이 돌아온다. 끊긴 사람의 카드 표시가 다른 화면에 보이고, 차례가 오면 자동 처리 문구가 나온다. 대기방에서 5초 안에 돌아오면 자리가 남고 넘기면 빠진다. 전송 직후 응답을 끊어도(`route.abort`) 칩이 한 번만 빠진다. 차례가 온 순간 새로고침해도 화면이 최신 상태로 돌아오고 베팅 초안이 남지 않는다. 숨김 후 복귀(`visibilitychange`)에 재연결한다.
  - `two-tabs.spec.ts`: 같은 컨텍스트의 새 탭은 보기만 가능하다. `이 화면에서 이어하기` 뒤 이전 탭 버튼이 막힌다. 한 탭을 닫아도 다른 탭이 있으면 접속 중이다.
  - `full-tournament.spec.ts`: 3명이 시작부터 종료, 다시 준비, 두 번째 시작까지 진행하고 모든 화면의 총 칩이 같다.
- [x] **Step 2: 실행과 수정** Run: `npm --prefix frontend run test:e2e:online` / Expected: 전부 PASS. 실패는 원인을 고친 뒤 다시 실행한다. 재시도로 통과시키지 않는다.
- [x] **Step 3: 문서 갱신**
  - `ARCHITECTURE.md`: `online-game` 지도, 온라인 명령 흐름, 상태 소유자 표, 테스트 실행법, 2B·온라인 준비 중 안내 제거
  - `MULTIPLAYER_MODE.md`: 19절 C06·C07의 화면 상태 표시, `기권 처리` 진입을 메뉴로 한정한 결정
  - `TECH_DECISIONS.md`: 탭 표시와 자동 인수, 온라인 E2E 분리, 대기방 재사용 결정
  - `frontend/DEVICE_CHECKS.md`: iPhone Safari 잠금 복귀, 앱 창 안 `/online/`, 초대 링크 공유
  - `IMPLEMENTATION_PROGRESS.md`: 실제 검증 결과와 미검증 항목
- [x] **Step 4: 주석 스캔** 이 계획에서 추가한 함수·컴포넌트·테스트에 한글 역할 주석이 있는지 전수 확인하고 빠진 곳을 채운다.
- [x] **Step 5: 최종 검증** Run: `backend/gradlew -p backend test`, `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, `npm --prefix frontend test -- --run`, `npm --prefix frontend run build`, `npm --prefix frontend run test:e2e`, `npm --prefix frontend run test:e2e:online` / Expected: 모두 PASS
- [x] **Step 6: 커밋** `git commit -m "test(online): cover reconnection flows and document the online screens"`

## 실행 완료 (2026-11-01)

- Task 1~10을 작업별 구현·검증·리뷰·로컬 커밋으로 완료했다. 종합 리뷰에서 발견한 13개 문제와 수정 후 재현된 2개 문제도 보완하고 최종 승인을 받았다.
- 최종 단위 테스트 383개, lint·typecheck·제품 빌드, 기본 온라인 E2E 56개가 통과했다. 백엔드 소스는 통합 수정에서 바꾸지 않았으며 앞선 638개 검증 결과를 유지한다.
- 전체 로컬 E2E는 447개 통과·기존 조건부 제외 3개였다. 마지막 보드 효과 수명 보완 뒤에는 관련 로컬 보드·게임 E2E 40개를 검증했다. 전체 로컬 검사를 마지막 보드 보완 후 다시 실행한 것은 아니다.
- 실제 모바일 기기와 실제 OS BFCache는 미검증이다. 이전 WebKit 재참가 실패의 최초 원인은 미확정이며, 원래 시나리오와 분리 검사는 유지했고 마지막 온라인 전체 실행에서 통과했다.
- 구체적인 수정 근거·과거 실패·검증 시점은 [IMPLEMENTATION_PROGRESS.md](../../../IMPLEMENTATION_PROGRESS.md)에 기록했다. push·PR·merge·배포는 수행하지 않았다.

## 계획 4로 넘기는 항목

- CI에서 온라인 E2E를 실행하는 방법과 백엔드 이미지·EC2 배포.
- 요청 빈도 제한, 특히 세션 하나의 방 반복 생성 제한.
- 배포 준비 중 시작·종료 취소 거절과 `서버 업데이트 중이라 취소할 수 없습니다` 안내.
- 실제 Tomcat 전송 정체, 재연결 간격과 5초 유예의 겹침, 동일 Wi-Fi 9명 실기기 측정.
