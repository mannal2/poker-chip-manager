# 바이인 2단계(멀티플레이) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 진행 중인 온라인 방에 새 사람이 바이인을 신청하거나 탈락자가 재입장을 신청하면, 방장이 자리를 정해 승인하고 서버가 Java 엔진으로 `BUY_IN`을 실행한다.

**Architecture:** Java 엔진에 1단계 TS 규칙을 그대로 옮기고 공용 픽스처 `buyin` 묶음으로 두 엔진을 맞춘다. 서버는 복구 신청(`RecoveryRequests`·`RecoveryCommands`·`RecoveryController`)과 같은 모양의 별도 목록 `BuyInRequests`를 두고, 승인 명령이 엔진 `BUY_IN`과 참가자·자리 연결을 한 번에 처리한다. 화면은 복구 신청의 대기 화면과 방장 알림(`HostRequests`)을 재사용하고, 자리 고르기는 1단계 단일기기 코드를 `gameplay`로 옮겨 함께 쓴다.

**Tech Stack:** Java 21 / Spring Boot(backend `game`·`game-json`·`server`), Gradle, JUnit; React 19 / TypeScript, Vitest, Playwright(`test:e2e:online`).

**Spec:** [docs/superpowers/specs/2026-11-19-buy-in-design.md](../specs/2026-11-19-buy-in-design.md)의 결정 9와 "멀티플레이 (2단계)" 절. 1단계에서 바뀐 결정이 우선한다: 재입장은 **원래 자리로만** 하고, 원래 자리를 다른 사람이 차지했을 때만 자리를 고른다([SINGLE_DEVICE_MODE.md](../../../SINGLE_DEVICE_MODE.md) 11-20 결정).

## 확정된 결정 (사용자 2026-11-21)

1. **방 인원 상한:** `Room.MAX_PARTICIPANTS`를 10에서 **15**로 올린다. 좌석 10개 제한은 엔진의 `seatOptions`가 지킨다. 자리를 빼앗긴 탈락자는 방에 관전자로 남고, 나중에 빈자리로 재입장할 수 있다. 15명이 차면 새 사람의 바이인 신청은 `ROOM_FULL`로 거절한다.
2. **새 사람의 이름이 기존 참가자(탈락자 포함)와 같을 때:** `DUPLICATE_NAME`으로 거절하고 "같은 이름의 플레이어가 있습니다. 기기를 바꾸셨다면 복구를 신청해 주세요."로 안내한다. 재입장은 방 안의 탈락자만 신청한다.
3. **대기 중 바이인 취소:** 첫 카드 전까지 방장만 `CANCEL_BUY_IN`할 수 있다. 새 사람이 취소되면 참가자에서 빠지고 "바이인이 취소되었습니다."를 보여 준 뒤 입장 화면으로 돌아간다. 재입장이 취소되면 원래 탈락자 기록에 다시 연결된다.
4. **탈락자의 신청 위치:** 오른쪽 위 메뉴(☰)의 `바이인` 버튼으로 신청한다. 단일기기에서 메뉴에 바이인을 둔 것과 같은 자리다. 신청 중에는 그 버튼 자리에 "방장의 승인을 기다리고 있습니다."를 보여 주고 다시 누를 수 없다.
5. **방장 화면:** 복구 신청처럼 화면 위 가운데 알림 줄(`HostRequests`)에 "P5 바이인 신청"(여러 건이면 "신청 n건")이 뜬다. 누르면 신청 목록이 열리고, 바이인 신청의 `승인`을 누르면 **단일기기 바이인 대화상자와 같은 모양**의 승인 화면이 열린다.
   - 같은 것: 대화상자 틀, 자리 고르기 칸(`SeatField`), 재입장의 "원래 자리로 돌아갑니다." / 원래 자리가 차지됐을 때의 안내와 자리 고르기, 아래 안내 문구(시작 칩과 참여 시점).
   - 다른 것: 탭과 이름 입력 대신 신청자 이름과 종류(새 플레이어 / 재입장 ×n)를 읽기 전용으로 보여 준다. 신청한 사람이 정한 값이라 방장이 바꾸지 않는다. 버튼은 `바이인 승인`과 `거절`이다.
   - 대기 중인 바이인 취소는 방장 메뉴(☰)의 `바이인` 버튼이 여는 대화상자에서 한다. 단일기기 대화상자 위쪽의 "대기 중인 바이인" 목록과 같은 모양이다.

## Global Constraints

- 엔진 규칙은 TS(`frontend/src/game`)와 Java(`backend/game`)가 같은 결과를 내야 하고, `shared/game-fixtures/buyin.json`의 모든 사례를 Java도 통과해야 한다.
- 새 규칙 오류 코드는 만들지 않는다(`shared/error-codes.json`의 `rules`는 Java `RuleErrorCode`와 같아야 함). 서버 오류 코드를 더하면 `shared/error-codes.json`의 서버 목록, Java `ErrorCode`, 프런트 `messageFor`를 함께 바꾼다.
- 신청 유효 시간은 복구와 같은 `RoomLifecycle.RECOVERY_REQUEST_LIFETIME`(5분)을 쓴다. 신청한 세션당 대기 신청은 최대 3건(`MAX_PER_SEAT`와 같은 값).
- 자격(credential)은 승인된 뒤 신청한 세션에게만 건넨다. 스냅샷에는 절대 넣지 않는다.
- 온라인 번들은 `local-game`을 import하지 않는다(ARCHITECTURE). 공유할 코드는 `features/gameplay`로 옮긴다.
- 화면 문구는 합니다체, 호칭은 플레이어, `해 주세요` 띄어쓰기. 새 함수·클래스 위에는 한글 한 줄 주석.
- 커밋 메시지·PR에 Claude 표시를 넣지 않는다.

## Review Focus

- 바이인 대기 중(첫 카드 전)에 방장이 바뀌거나 나감: 대기 신청과 대기 바이인이 새 방장 화면에 그대로 보인다.
- 승인 직전에 신청이 만료되거나 다른 바이인이 그 자리를 먼저 차지함: 승인이 `BUY_IN_NOT_PENDING` 또는 엔진 거절로 끝나고 방 상태는 바뀌지 않는다.
- 재입장한 사람의 기존 연결(같은 세션): 승인 뒤 새 플레이어 기록으로 조작되며, 옛 플레이어 ID로 보낸 명령은 거절된다.
- 서버 재시작(스냅샷 복원): 바이인으로 늘어난 참가자·`entry`·`joining`·`formerPlayers`가 그대로 돌아온다.
- 토너먼트가 끝난 뒤(`ENDED`)의 바이인 신청: 거절된다.

---

### Task 1: Java 엔진 바이인 규칙

**Files:**
- Modify: `backend/game/src/main/java/xyz/jwlee/poker/game/model/Player.java`, `GameState.java` (`entry`, `joining`, `replaced`, `formerPlayers`)
- Modify: `backend/game/src/main/java/xyz/jwlee/poker/game/command/GameCommand.java` (`BuyIn`, `CancelBuyIn`), `SetupCommands.java` 또는 새 `BuyInCommands.java`, `Round.java`(다음 핸드 참여 규칙), `Tournament.java`(종료 판정), `Invariants.java`
- Modify: `backend/game-json/src/main/java/.../GameJson.java`, `EventJson.java`
- Modify: `backend/game/src/test/java/xyz/jwlee/poker/game/fixtures/FixtureFiles.java` (`SUITES`에 `"buyin"`)

**Interfaces:**
- Consumes: TS 기준 구현 `frontend/src/game/commands/*`의 `BUY_IN`·`CANCEL_BUY_IN`, `round.ts`의 `startHand` 참여 규칙(고정점 반복, 헤즈업→3인 계산), `types.ts`의 필드 이름. JSON 필드 이름과 이벤트 이름은 TS와 글자까지 같아야 한다.
- Produces: `GameCommand.BuyIn(String name, BuyInPlacement placement, String reentryOf)`, `GameCommand.CancelBuyIn(String playerId)`, `BuyInPlacement`(`Between(String after)` | `Replace(String playerId)`). 서버(Task 2)가 이 명령을 만든다.

- [ ] **Step 1:** `SUITES`에 `"buyin"`을 넣고 `./gradlew -p backend :game:test` → buyin 사례들이 FAIL(알 수 없는 명령)
- [ ] **Step 2:** 모델 필드와 JSON 읽기·쓰기를 더한다. 기존 픽스처의 상태(새 필드 없음)는 그대로 읽혀야 한다.
- [ ] **Step 3:** 명령 두 개, 참여 규칙, 종료 판정(대기 바이인이 있으면 끝내지 않음), 불변식(칩 총량에 바이인 칩 포함)을 TS와 같은 순서로 옮긴다.
- [ ] **Step 4:** `./gradlew -p backend :game:test :game-json:test` → 전체 PASS. TS도 `cd frontend && npx vitest run tests/game` → PASS(픽스처 공유 확인).
- [ ] **Step 5: Commit** — `feat: port buy-in rules to the Java engine`

### Task 2: 서버 바이인 신청·승인

**Files:**
- Create: `backend/server/src/main/java/xyz/jwlee/poker/server/room/BuyInRequests.java`, `BuyInCommands.java`, `backend/server/src/main/java/xyz/jwlee/poker/server/api/BuyInController.java`
- Modify: `Room.java`(참가자 추가 경로, `MAX_PARTICIPANTS` 15, `playerIds` 다시 연결), `CommandPipeline.java`(새 명령), `RoomLifecycle.java`(만료 쓸기), `SnapshotWriter.java`(대기 신청 게시), `ErrorCode.java`, `shared/error-codes.json`
- Test: `backend/server/src/test/...` 복구 신청 테스트와 같은 위치에 `BuyInCommandsTest`, `BuyInControllerTest`

**Interfaces:**
- Consumes: Task 1의 `GameCommand.BuyIn`·`CancelBuyIn`.
- Produces (API, Task 4가 씀):
  - `POST /api/buy-in-requests` `{ roomCode, name }` → `{ buyInRequestId, status: 'PENDING', expiresAt }`. 방이 `PLAYING`이 아니면 `NOT_WAITING`과 같은 뜻의 `BUY_IN_CLOSED`, 이름 충돌은 `DUPLICATE_NAME`.
  - `GET /api/buy-in-requests/{id}` → 복구의 `RecoveryStatus`와 같은 모양. `APPROVED`이면 `JoinResponse`(참가자 ID, 자격)를 함께 준다.
  - 방 명령 `REQUEST_BUY_IN`(payload 없음): 탈락한 참가자 본인만. `reentryOf`는 서버가 그 참가자의 현재 플레이어 ID로 채운다.
  - 방 명령 `BUY_IN_APPROVE { buyInRequestId, placement }`, `BUY_IN_REJECT { buyInRequestId }`, `CANCEL_BUY_IN { playerId }`: 방장만.
  - 스냅샷 `buyInRequests: { buyInRequestId, name, reentryOf: string | null, requestedAt, expiresAt }[]`(대기 중만).
- 승인 처리 순서: 신청이 대기 중인지 확인 → 엔진 `BUY_IN` 실행(거절이면 그대로 거절) → 새 사람이면 `addParticipant`(PLAYING 허용 경로)와 자격 발급, 재입장이면 `playerIds`를 새 플레이어 ID로 다시 연결 → 신청을 승인으로 끝냄 → 버전 올림. 중간에 실패하면 방 상태를 바꾸지 않는다.
- `CANCEL_BUY_IN` 뒤: 새 사람은 참가자에서 빼고 연결을 닫는다. 재입장은 `playerIds`를 원래 탈락 플레이어 ID로 되돌린다.

- [ ] **Step 1: 실패하는 테스트** — 복구 테스트를 본떠 다음을 쓴다: 대기 방에서 신청 거절(`BUY_IN_CLOSED`), 진행 방에서 신청→승인→`APPROVED`와 자격, 승인된 사람의 명령이 새 플레이어로 처리됨, 재입장 신청→승인 뒤 옛 ID 명령 거절, 거절·만료·한도 3건, 방장 아닌 사람의 승인 거절, 대기 바이인 취소 뒤 참가자 정리, 종료된 토너먼트 신청 거절, 스냅샷에 자격이 없음.
- [ ] **Step 2:** `./gradlew -p backend :server:test --tests '*BuyIn*'` → FAIL
- [ ] **Step 3:** 구현. 오류 코드는 `BUY_IN_CLOSED`, `BUY_IN_LIMIT`, `BUY_IN_NOT_PENDING`, `NOT_ELIMINATED`를 더하고 `shared/error-codes.json`에 같은 이름을 넣는다.
- [ ] **Step 4:** `./gradlew -p backend test` → 전체 PASS(재시작 스냅샷 왕복 테스트 포함). `shared/api-contract/`에 신청·상태 예시 JSON 두 개를 더한다.
- [ ] **Step 5: Commit** — `feat: let hosts approve buy-in requests in a running room`

### Task 3: 자리 고르기를 공통으로 옮기기

**Files:**
- Move: `frontend/src/features/local-game/model/buyIn.ts`의 `seatOptions`·`SeatOption`·`buyInBlockReason` → `frontend/src/features/gameplay/model/buyIn.ts`
- Move: `BuyInDialog.tsx`의 `SeatField`, `reentryCandidates`가 쓰는 표시 부분 중 공통인 것 → `frontend/src/features/gameplay/components/SeatField.tsx`
- Modify: 단일기기 import 경로, 관련 테스트 경로

**Interfaces:**
- Produces: `seatOptions(state): SeatOption[]`, `<SeatField options seat busy onChange />`. 동작은 그대로다.

- [ ] **Step 1:** 옮기고 import를 고친다(동작 변경 없음).
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit -p . && npx vitest run tests/local-game && npx playwright test buy-in.spec.ts` → PASS
- [ ] **Step 3: Commit** — `refactor: share the buy-in seat picker with online play`

### Task 4: 온라인 API·컨트롤러

**Files:**
- Modify: `frontend/src/features/online-game/api/types.ts`(스냅샷 `buyInRequests`, 상태 응답 타입, 검사 함수), `api/client.ts`(`requestBuyIn`, `buyInStatus`), `session/onlineController.ts`(새 명령 전송), `features/gameplay/model/errorMessages.ts`(새 서버 코드 문구)
- Test: 기존 `frontend/tests/online-game/*` 의 API·컨트롤러 테스트 옆

**Interfaces:**
- Consumes: Task 2의 API 모양.
- Produces: `requestBuyIn(roomCode, name): Promise<BuyInRequestResponse>`, `buyInStatus(id): Promise<BuyInStatus>`. 복구의 `requestRecovery`·`recoveryStatus`와 같은 오류·재시도 규칙.
- 문구: `BUY_IN_CLOSED` "지금은 바이인을 받을 수 없습니다.", `BUY_IN_LIMIT` "바이인 신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", `BUY_IN_NOT_PENDING` "이미 처리된 바이인 신청입니다.", `NOT_ELIMINATED` "탈락한 플레이어만 다시 참가할 수 있습니다."

- [ ] **Step 1:** 타입 검사 함수와 클라이언트의 실패하는 테스트(복구 테스트를 본뜸) → FAIL
- [ ] **Step 2:** 구현 → `npx vitest run tests/online-game` PASS
- [ ] **Step 3: Commit** — `feat: add the online buy-in request API client`

### Task 5: 신청 화면(새 사람·탈락자)

**Files:**
- Modify: `frontend/src/features/online-game/components/OnlineEntry.tsx`(참가 탭에서 `NOT_WAITING`을 받으면 "게임이 진행 중입니다. 바이인을 신청할까요?" 확인 → 신청), 복구 대기 화면 컴포넌트(신청 종류만 바꿔 재사용), `OnlineMenu.tsx`(결정 4: 탈락한 본인의 메뉴에 `바이인` 버튼 → `REQUEST_BUY_IN`, 대기 중이면 그 자리에 "방장의 승인을 기다리고 있습니다.")
- Test: 해당 컴포넌트 테스트

- [ ] **Step 1:** 실패하는 컴포넌트 테스트: 진행 중 방 참가 → 확인 → 신청 호출, 승인 상태 → 방 입장, 거절·만료 → 안내 후 입장 화면, 탈락자 버튼 → 명령 전송, 탈락하지 않은 사람에게는 버튼 없음.
- [ ] **Step 2:** 구현 → 테스트 PASS
- [ ] **Step 3: Commit** — `feat: let late arrivals and eliminated players ask to buy in`

### Task 6: 방장 승인·취소 화면

**Files:**
- Modify: `frontend/src/features/online-game/components/HostRequests.tsx`(결정 5: 위 가운데 알림 줄과 신청 목록에 복구 신청과 바이인 신청을 함께 표시), 새 `BuyInApproval.tsx`(단일기기 대화상자와 같은 모양의 승인 화면), `OnlineMenu.tsx`(방장 메뉴의 `바이인` → 대기 중인 바이인 목록과 `바이인 취소`)
- 단일기기 `BuyInDialog.tsx`와 겹치는 부분(재입장 안내, 안내 문구, 대기 목록)은 Task 3에서 `gameplay`로 옮긴 조각을 함께 쓴다. 필요하면 Task 3 범위에 그 조각을 더한다.
- Test: 컴포넌트 테스트

- [ ] **Step 1:** 실패하는 테스트: 바이인 신청 알림 표시, 승인 시 고른 자리로 `BUY_IN_APPROVE`, 재입장 원래 자리 승인은 자리를 묻지 않음, 거절, 대기 바이인 취소 → `CANCEL_BUY_IN`.
- [ ] **Step 2:** 구현 → PASS
- [ ] **Step 3: Commit** — `feat: approve buy-ins with a seat choice for the host`

### Task 7: 온라인 E2E·문서·전체 검증

**Files:**
- Create: `frontend/e2e/online/buy-in.spec.ts`
- Modify: `MULTIPLAYER_MODE.md`, `docs/superpowers/specs/2026-11-19-buy-in-design.md`(결정 3을 원래 자리 전용으로 고침), `IMPLEMENTATION_PROGRESS.md`, `ARCHITECTURE.md`(새 서버 클래스·공통 자리 고르기)

- [ ] **Step 1:** E2E: 진행 중 방에 새 탭이 참가 → 바이인 신청 → 방장이 자리 골라 승인 → 다음 핸드에 그 자리에서 카드 받음. 탈락자 재입장 → 원래 자리 → `×2` 표시. 방장 거절. 대기 바이인 취소.
- [ ] **Step 2:** `cd backend && ./gradlew test`, `cd frontend && npx tsc --noEmit -p . && npx vitest run && npx eslint .`, `npm run test:e2e:online`, `npm run test:e2e:restart`, 로컬 `npx playwright test`(약 4.5분) → 모두 PASS
- [ ] **Step 3: Commit** — `docs: record the multiplayer buy-in flow`
