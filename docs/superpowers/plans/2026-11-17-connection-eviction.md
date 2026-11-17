# 연결 한도 초과 시 오래된 연결 밀어내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자리당 4개·세션당 8개 연결 한도에 걸리면 새 연결을 거절하지 않고 가장 오래 응답이 없는 연결을 4001로 닫고, 밀려난 화면은 자동 재연결을 멈춘다.

**Architecture:** 서버는 `Connection`에 생성 순번을 붙이고, `ConnectionHub`가 후보 중 `lastPong`이 가장 오래된(같으면 순번이 작은) 연결을 고른다. 세션 한도는 `ConnectionHub.register`에서, 자리 한도는 `RoomSocketHandler.attachInRoom`(방 잠금 안)에서 밀어낸다. `Connection.close`는 소켓 닫기와 방 정리를 별도 가상 스레드에서 하므로 잠금 안에서 불러도 된다. 화면은 `RoomSocket`이 4001을 받으면 재연결 타이머 없이 멈추고 `onReplaced`를 알리며, 컨트롤러가 `connection: 'replaced'`로 바꿔 배너가 안내와 버튼을 보여 준다.

**Tech Stack:** Java 21 + Spring Boot(WebSocket), JUnit 5 + AssertJ + Awaitility; React 19 + TypeScript, Vitest

**Spec:** [docs/superpowers/specs/2026-11-17-connection-eviction-design.md](../specs/2026-11-17-connection-eviction-design.md)

## Global Constraints

- 브랜치: `connection-eviction` (`origin/main`에서 분기, 이미 생성됨). push는 `git push -u origin connection-eviction`.
- 밀려난 연결의 닫힘 코드: `4001`. 서버 전체 한도 초과는 지금처럼 `1013`.
- 한도 값은 그대로: 자리당 4, 세션당 8, 서버 전체 500.
- 배너 문구: `다른 화면이 이 자리에 연결되어 이 화면의 연결을 멈췄습니다.`, 버튼 `이 화면에서 다시 연결`.
- 1013 문구: `지금은 서버 연결이 많습니다. 잠시 후 자동으로 다시 연결합니다.`
- 화면 문구는 합니다체로 쓰고, 새 함수·클래스 위에는 한 줄 한글 주석을 단다. 커밋 메시지에는 Claude 표시를 넣지 않는다. 각 태스크 뒤에 검증하고 그 태스크만 커밋한다.

## Review Focus

1. 밀어낼 후보는 같은 자리(또는 같은 세션)의 연결로만 한정해야 한다. 다른 참가자·다른 세션의 연결을 닫으면 안 된다 → Task 1 `evictsOnlyFromTheSameSession`, Task 2 `theFifthScreenReplacesTheStalestOfTheSameSeat`(다른 참가자 연결 유지 단언 포함).
2. 응답이 최근인 살아 있는 연결보다 응답이 끊긴 연결이 먼저 밀려나야 한다 → Task 1 `evictsTheConnectionSilentTheLongest`.
3. 밀려난 화면은 4001을 받은 뒤 자동으로 다시 연결하지 않아야 한다(서로 밀어내는 반복 방지) → Task 3 `stops reconnecting after being replaced`.
4. 밀려난 화면도 다시 보이면 연결을 되찾아야 한다 → Task 3 `reconnects a replaced screen when it becomes visible`.
5. 밀려난 연결이 방에서 떨어져도 그 참가자가 끊긴 것으로 바뀌면 안 된다(새 연결이 남아 있으므로) → Task 2 단언 `connected`가 `true`로 유지.

---

### Task 1: 세션 한도에서 가장 오래 응답 없는 연결을 밀어낸다

**Files:**
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/realtime/Connection.java` (상수 `CLOSE_REPLACED = 4001`, 생성 순번)
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/realtime/ConnectionHub.java:54-63`
- Create: `backend/server/src/test/java/xyz/jwlee/poker/server/realtime/ConnectionHubTest.java`
- Modify: `backend/server/src/test/java/xyz/jwlee/poker/server/realtime/RoomSocketHttpTest.java:739-752` (`theNinthSocketOfASession...`)

**Interfaces:**
- Produces:
  - `static final int CLOSE_REPLACED = 4001;` (`Connection`)
  - `long serial()` (`Connection`) — `open()`마다 1씩 늘어나는 전역 순번.
  - `static Optional<Connection> stalest(Collection<Connection> candidates)` (`ConnectionHub`) — 닫히지 않은 후보 중 `lastPong` 최소, 같으면 `serial` 최소.
  - `Optional<Connection> find(String connectionId)` (`ConnectionHub`)
  - `register`의 의미 변경: 서버 전체 한도면 `false`. 세션 한도면 `stalest(같은 세션)`을 `close(CLOSE_REPLACED)`하고 목록에서 뺀 뒤 새 연결을 넣고 `true`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`ConnectionHubTest`, 기존 `FakeSocket`(`closedWith`로 닫힘 코드 확인)과 `xyz.jwlee.poker.server.room.MutableClock` 사용)

```java
// 세션의 아홉 번째 연결은 받아들이고 가장 오래 응답 없는 연결을 4001로 닫는다
@Test void evictsTheConnectionSilentTheLongest()
//   같은 세션 8개 등록(시계를 1초씩 진행하며 열기) → 3번째만 남기고 모두 pong으로 lastPong 갱신
//   9번째 register == true, 3번째 연결의 FakeSocket이 4001로 닫힘(await), hub.connections().size() == 8
// 응답 시각이 같으면 먼저 열린 연결을 밀어낸다
@Test void breaksTiesByOpeningOrder()
// 다른 세션의 연결은 밀어내지 않는다
@Test void evictsOnlyFromTheSameSession()
//   세션 A 8개 + 세션 B 1개(가장 오래됨) → A의 9번째 등록 시 B 연결은 열린 채 유지
// 서버 전체 한도는 지금처럼 새 연결을 거절한다
@Test void stillRefusesNewConnectionsAtTheServerLimit()
```


- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && ./gradlew :server:test --tests "*ConnectionHubTest"`
Expected: 컴파일 실패 또는 FAIL(밀어내기 없음).

- [ ] **Step 3: 구현한다**

`Connection`에 `private static final AtomicLong SERIALS`와 `serial` 필드를 둔다. `register`는 `synchronized` 안에서 같은 세션 연결 목록을 만들고, 한도면 `stalest`로 고른 연결을 `connections.remove(id, victim)` 후 `victim.close(Connection.CLOSE_REPLACED)`. `close`는 비동기이므로 잠금 안에서 불러도 된다.

- [ ] **Step 4: HTTP 테스트를 새 규칙에 맞춘다**

`theNinthSocketOfASessionIsClosedAndTheOthersAndOtherSessionsAreFine`을 `theNinthSocketOfASessionReplacesTheStalest`로 바꾼다. 9번째는 열린 채 구독까지 되고, 가장 오래 응답 없는 1번째가 4001로 닫히고, 다른 세션은 무사한지 단언한다.

Run: `cd backend && ./gradlew :server:test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add backend/server
git commit -m "feat: replace the stalest socket of a session at its limit"
```

---

### Task 2: 자리 한도에서 같은 자리의 가장 오래 응답 없는 연결을 밀어낸다

**Files:**
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/realtime/RoomSocketHandler.java:189-204` (`attachInRoom`), `:52` (`Subscription.FULL` 제거)
- Modify: `backend/server/src/test/java/xyz/jwlee/poker/server/realtime/RoomSocketHttpTest.java:417-437`

**Interfaces:**
- Consumes: Task 1의 `ConnectionHub.find`, `ConnectionHub.stalest`, `Connection.CLOSE_REPLACED`.
- Produces: 자리 한도에서 더 이상 1013을 보내지 않는다. `Subscription`은 `ACCEPTED, NO_SEAT, CLOSING`만 남는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`RoomSocketHttpTest`, 기존 `theFifthConnectionOfAParticipant...`를 바꾼다)

```java
// 다섯 번째 화면은 받아들이고 같은 자리에서 가장 오래 응답 없는 화면을 4001로 닫는다
@Test void theFifthScreenReplacesTheStalestOfTheSameSeat()
//   host 화면 4개 구독(시계 진행) → 2~4번째는 PING에 PONG, 1번째는 응답 안 함
//   게스트 1명 구독(다른 참가자)
//   5번째 host 화면 구독 → SNAPSHOT 받음, 1번째가 4001로 닫힘
//   connectionCount(host) == 4, 게스트 화면은 RESYNC에 SNAPSHOT으로 응답(유지)
//   host가 끊긴 참가자로 바뀌지 않음(스냅샷의 host connected == true)
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && ./gradlew :server:test --tests "*RoomSocketHttpTest"`
Expected: 새 테스트 FAIL(5번째가 1013으로 닫힘).

- [ ] **Step 3: 구현한다**

`attachInRoom`에서 연결 수가 한도면, `room.presence().subscribers()` 중 값이 이 `participantId`인 연결 id로 `hub.find`해 후보를 모으고 `ConnectionHub.stalest`로 고른 연결을 `close(Connection.CLOSE_REPLACED)`한다. 그다음 새 연결을 그대로 붙인다(`RoomLifecycle.connected`). 밀려난 연결의 방 정리는 그 연결의 닫힘 콜백이 나중에 방 잠금을 잡아 처리하고, 같은 자리에 새 연결이 있으므로 접속 상태는 바뀌지 않는다. `FULL` 분기와 `Subscription.FULL`을 지운다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd backend && ./gradlew :server:test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add backend/server
git commit -m "feat: replace the stalest screen of a seat at its limit"
```

---

### Task 3: 밀려난 화면은 재연결을 멈추고 안내한다

**Files:**
- Modify: `frontend/src/features/online-game/realtime/roomSocket.ts` (4001 처리, `onReplaced`)
- Modify: `frontend/src/features/online-game/session/onlineController.ts` (`connection` 유니언에 `'replaced'`, `onReplaced`, 1013 문구)
- Modify: `frontend/src/features/online-game/components/ConnectionBanner.tsx`
- Test: `frontend/tests/online-game/roomSocket.test.ts`, `onlineController.test.ts`, `roomManagement.test.tsx`(배너 렌더 확인이 쉬운 곳) 또는 새 `connectionBanner.test.tsx`

**Interfaces:**
- Produces:
  - `RoomSocketHandlers.onReplaced?(): void`
  - `OnlineView.connection: 'online' | 'syncing' | 'offline' | 'replaced'`
  - `RoomSocket`: 4001로 닫히면 재연결 타이머를 걸지 않고 `setState('waiting')` 후 `onReplaced`를 부른다. `reconnect()`(버튼)와 화면 복귀(`visibilitychange` visible)는 멈춤을 풀고 새로 연결한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// roomSocket.test.ts
it('stops reconnecting after being replaced', ...);
//   열린 소켓을 close(4001) → onReplaced 1회, 타이머를 30초 진행해도 새 FakeSocket 없음
it('reconnects a replaced screen when it becomes visible', ...);
//   4001 뒤 visibilityState='visible' + visibilitychange → 새 FakeSocket 1개
it('reconnects a replaced screen on a manual retry', ...);
//   4001 뒤 reconnect() → 새 FakeSocket 1개
// onlineController.test.ts
it('marks a replaced screen and returns to online on the next snapshot', ...);
//   h.onReplaced!() → connection === 'replaced'; 이후 onSnapshot → 'online'
it('explains the server-wide connection limit', ...);
//   기존 'shows the too-many-screens notice...' 테스트의 기대 문구를 새 1013 문구로 바꾼다
// ConnectionBanner
it('offers to reconnect a replaced screen', ...);
//   connection 'replaced' → 안내 문구와 '이 화면에서 다시 연결' 버튼, 누르면 controller.reconnect 호출
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && npx vitest run tests/online-game`
Expected: 새 테스트 FAIL.

- [ ] **Step 3: 구현한다**

`RoomSocket`에 `private replaced = false`를 둔다. `onclose`에서 `event.code === 4001`이면 `replaced = true`, 현재 소켓을 비우고 타이머들을 지운 뒤 `setState('waiting')`과 `onReplaced`만 하고 `recoverHandshake`를 부르지 않는다. `connect()`의 예약 경로(`wait`)는 `replaced`이면 타이머를 걸지 않는다. `reconnect()`와 `onVisibility`(visible)는 `replaced = false`로 풀고 연결한다. 컨트롤러는 `onReplaced`에서 `connection: 'replaced'`, `onState`가 `'waiting'`으로 덮어쓰지 않도록 `replaced` 상태를 지킨다(다음 `connecting`에서 `syncing`으로). `ConnectionBanner`는 `connection === 'replaced'`일 때 Global Constraints의 문구와 버튼을 보여 준다. `TOO_MANY_SCREENS` 상수의 문구를 1013 문구로 바꾼다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && npx tsc --noEmit -p . && npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src frontend/tests
git commit -m "feat: pause a replaced screen until it is used again"
```

---

### Task 4: 문서를 고치고 통합 확인한다

**Files:**
- Modify: `SYSTEM_SPEC.md:442,462-463` (1013·4001 닫힘 코드, 자리·세션 WS 한도 동작)
- Modify: `MULTIPLAYER_MODE.md` (연결 절에 "한도에 걸리면 가장 오래 응답 없는 연결을 밀어내고, 밀려난 화면은 다시 보일 때 연결" 한 줄과 결정 기록 2026-11-17)

- [ ] **Step 1: 문서를 고친다**
- [ ] **Step 2: 백엔드 전체 테스트** — Run: `cd backend && ./gradlew test` / Expected: PASS
- [ ] **Step 3: 프론트 빌드** — Run: `npm --prefix frontend run build` / Expected: 오류 없음
- [ ] **Step 4: 온라인 E2E 전체** — Run: `npm --prefix frontend run test:e2e:online` / Expected: PASS(특히 `two-tabs.spec.ts`, `reconnect.spec.ts`)
- [ ] **Step 5: 커밋한다**

```bash
git add SYSTEM_SPEC.md MULTIPLAYER_MODE.md
git commit -m "docs: describe replacing the stalest connection at the limits"
```
