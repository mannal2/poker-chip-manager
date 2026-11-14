# 연결 끊김 유예 시간 조정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대기방에서 연결이 끊긴 참가자를 5초가 아니라 5분 동안 명단에 남기고, 게임 중에는 끊긴 지 30초가 지난 뒤에만 자동 체크·폴드한다.

**Architecture:** 두 유예 시간을 `PresenceGrace` 레코드로 묶어 `RoomEnv`에 싣는다. 대기방 만료(`RoomLifecycle.expireAbsences`)는 `env.grace().waitingReconnect()`를 읽고, `AutoPlay`는 행동자가 `env.grace().autoPlay()` 이상 끊겨 있을 때만 대신 행동한다. 끊긴 지 30초가 지나는 순간에는 아무 이벤트도 없으므로 1초 방 점검(`RoomLifecycle.sweep`)의 PLAYING 분기에서도 `AutoPlay.run`을 돌린다. 운영 기본값은 300초·30초이고, `e2e` 프로필만 짧게 줄여 실제 서버 E2E가 몇 분씩 기다리지 않게 한다.

**Tech Stack:** Java 21 + Spring Boot(backend/server), JUnit 5 + AssertJ, Playwright(frontend/e2e/online)

**Spec:** 이 문서의 Goal과 아래 결정 사항(2026-11-14 사용자 확정). 기존 규칙은 [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 13절, [SYSTEM_SPEC.md](../../../SYSTEM_SPEC.md) 9절에 있다.

결정 사항:
- 대기방 재접속 유예: 5초 → **5분(300초)**. 링크를 공유하려고 카톡을 열어도 방에 남아야 한다.
- 유예 중 시작 차단(`NOT_CONNECTED`)은 그대로 둔다. 실제로 떠난 사람은 방장이 기존 `KICK`으로 내보낸다(대기방 KICK은 이미 본인 외 누구에게나 가능).
- 첫 연결 대기(`FIRST_CONNECTION_WAIT` 30초)는 바꾸지 않는다.
- 게임 중 자동 체크·폴드: 즉시 → **끊긴 시점부터 30초 뒤**. 차례가 올 때마다 새로 세지 않는다. 이미 30초 넘게 끊긴 사람에게 차례가 오면 즉시 자동 처리한다.
- 화면(frontend) 코드는 바꾸지 않는다. 남은 시간 표시는 이번 범위가 아니다.

## Global Constraints

- 브랜치: `presence-grace` (`online-name-check`에서 분기, 이미 생성됨).
- 새 함수·클래스 위에는 역할을 한 줄 한글 주석으로 단다(저장소 관례).
- 커밋 메시지에 Claude 표시(Co-Authored-By, 생성 문구)를 넣지 않는다.
- 운영 기본값: `poker.waiting-reconnect-grace-seconds` = 300, `poker.auto-play-grace-seconds` = 30.
- `e2e` 프로필 값: `waiting-reconnect-grace-seconds: 5`, `auto-play-grace-seconds: 2`.
- 상태 버전은 게임이 실제로 바뀐 경우에만 올린다(점검에서 자동 처리가 없었으면 버전 그대로).
- 각 태스크가 끝나면 관련 검증을 실행하고 그 태스크만 커밋한다. push·PR은 하지 않는다.

## Review Focus

1. 게임 중 끊긴 사람이 30초 안에 돌아오면 자동 처리 없이 본인이 직접 행동해야 한다 → Task 2 `aPlayerWhoReturnsWithinTheGraceActsThemselves`.
2. 이미 30초 넘게 끊긴 사람에게 차례가 넘어오면 다른 사람 명령의 같은 응답 안에서 바로 자동 처리되어야 한다 → Task 2 `aLongGoneActorIsPlayedForInsideTheSameResponse`.
3. 전원이 끊긴 방에서는 점검이 30초를 넘겨도 혼자 진행하지 않아야 한다 → Task 2 `theSweepDoesNotPlayWhenNobodyIsConnected`.
4. 대기방에서 방장이 끊겨도 5분 동안은 방장이 유지되고, 그 사이 시작은 막힌다 → Task 1 `aDisconnectedHostKeepsTheRoomForTheWholeGrace`.
5. 대기방에서 끊긴 참가자는 유예 중에도 방장이 즉시 내보낼 수 있어야 한다 → Task 1 `theHostCanKickSomeoneStillInTheGrace`.

---

### Task 1: 대기방 재접속 유예를 5분으로 늘리고 설정값으로 바꾼다

**Files:**
- Create: `backend/server/src/main/java/xyz/jwlee/poker/server/room/PresenceGrace.java`
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/room/RoomEnv.java`
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/room/RoomLifecycle.java:15,78-82`
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/support/TimeConfig.java`
- Modify: RoomEnv를 만드는 4곳 — `api/RecoveryController.java:46-48`, `realtime/RoomSocketHandler.java:76-81`, `registry/RoomRegistry.java:95-110,283`, `room/CommandPipeline.java:102-109`
- Modify: `backend/server/src/main/resources/application.yaml` (`e2e` 프로필)
- Test: `backend/server/src/test/java/xyz/jwlee/poker/server/room/RoomLifecycleTest.java`, `RecoveryCommandsTest.java`, 그 밖에 5초 유예를 전제한 테스트

**Interfaces:**
- Produces:
  - `public record PresenceGrace(Duration waitingReconnect, Duration autoPlay)` 와 `public static final PresenceGrace DEFAULT = new PresenceGrace(Duration.ofMinutes(5), Duration.ofSeconds(30));`
  - `public record RoomEnv(Clock clock, IdGenerator ids, StartGate gate, PresenceGrace grace)` — 기존 `RoomEnv(Clock, IdGenerator, StartGate)`와 `RoomEnv(Clock, IdGenerator)` 생성자는 `PresenceGrace.DEFAULT`로 위임해 유지한다.
  - Spring 빈 `PresenceGrace presenceGrace(@Value("${poker.waiting-reconnect-grace-seconds:300}") long waitingSeconds, @Value("${poker.auto-play-grace-seconds:30}") long autoPlaySeconds)` — `TimeConfig`에 둔다.
  - `CommandPipeline(Clock, IdGenerator, StartGate, PresenceGrace)` 생성자 추가(Spring이 쓰도록 `@Autowired`가 필요하면 붙인다). 기존 2·3인자 생성자는 DEFAULT로 위임한다.
  - `RoomRegistry`의 `@Autowired` 생성자에 `PresenceGrace grace` 파라미터를 추가하고 `sweepAll()`의 `new RoomEnv(clock, ids, gate, grace)`에 넘긴다. 테스트용 짧은 생성자는 DEFAULT로 위임한다.
  - `RecoveryController`, `RoomSocketHandler` 생성자에 `PresenceGrace grace`를 추가해 `RoomEnv`에 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`RoomLifecycleTest`, 기본 env = `PresenceGrace.DEFAULT`)

```java
// 대기방에서 끊긴 사람은 5분 직전까지 명단에 남고 5분이 되면 빠지는지 확인한다
@Test
void aDisconnectedParticipantStaysForFiveMinutes() {
    Room room = new CommandFixture(2, clock).room;
    drop(room, "b");
    pass(Duration.ofMinutes(5).minusMillis(1).toMillis());
    RoomLifecycle.sweep(room, env);
    assertThat(roster(room)).containsExactly("a", "b");

    pass(1);
    RoomLifecycle.sweep(room, env);
    assertThat(roster(room)).containsExactly("a");
}

// 방장이 끊겨도 유예 내내 방장이 유지되고 시작은 막히는지 확인한다
@Test
void aDisconnectedHostKeepsTheRoomForTheWholeGrace() {
    Room room = new CommandFixture(2, clock).room;
    drop(room, "a");
    pass(Duration.ofMinutes(4).toMillis());
    RoomLifecycle.sweep(room, env);
    assertThat(room.hostId()).isEqualTo("a");
    assertThat(StartConditions.blockReason(room, new StartGate())).contains(ErrorCode.NOT_CONNECTED);
}

// 유예 중인 참가자도 방장이 바로 내보낼 수 있는지 확인한다
@Test
void theHostCanKickSomeoneStillInTheGrace() {
    CommandFixture f = new CommandFixture(2, clock);
    drop(f.room, "b");
    assertThat(code(f.send("a", "KICK", "{\"participantId\":\"b\"}"))).isEqualTo("OK");
    assertThat(roster(f.room)).containsExactly("a");
}

// 설정한 유예 값을 env에서 읽는지 확인한다
@Test
void theWaitingGraceComesFromTheEnvironment() {
    RoomEnv shortGrace = new RoomEnv(clock, IdGenerator.random(), new StartGate(),
            new PresenceGrace(Duration.ofSeconds(5), Duration.ofSeconds(30)));
    Room room = new CommandFixture(2, clock).room;
    drop(room, "b");
    pass(5_000);
    RoomLifecycle.sweep(room, shortGrace);
    assertThat(roster(room)).containsExactly("a");
}
```

`pass`, `drop`, `roster`, `code`는 이 테스트 파일에 이미 있는 도우미다. `pass`가 `long`을 받지 않으면 맞춰 쓴다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && ./gradlew :server:test --tests "*RoomLifecycleTest"`
Expected: 컴파일 실패(`PresenceGrace` 없음).

- [ ] **Step 3: 구현한다**

`PresenceGrace` 레코드와 `DEFAULT`, `RoomEnv`의 4번째 컴포넌트와 위임 생성자, `TimeConfig`의 빈, 4곳의 생성자 연결을 만든다. `RoomLifecycle`에서 `WAITING_RECONNECT_GRACE` 상수를 지우고 `graceOver(room, id, now)`가 `env.grace().waitingReconnect()`를 쓰도록 `expireAbsences`에 env(또는 그 값)를 넘긴다. `FIRST_CONNECTION_WAIT`는 그대로 둔다. `application.yaml`의 `e2e` 프로필 `poker:` 아래에 `waiting-reconnect-grace-seconds: 5`를 추가하고, 기존 E2E가 5초 유예를 전제로 한다는 주석을 한 줄 단다.

- [ ] **Step 4: 기존 5초 전제 테스트를 고친다**

Run: `cd backend && ./gradlew :server:test`
실패하는 테스트 중 대기방 5초 만료를 전제한 것(`RoomLifecycleTest`의 `pass(5_000)`·`pass(1_000)+pass(4_000)` 계열, `RecoveryCommandsTest`의 `clock.advance(Duration.ofSeconds(5))` 두 곳 등)은 시간 간격을 `PresenceGrace.DEFAULT.waitingReconnect()` 기준으로 바꾼다. 상대 간격(먼저 끊긴 사람 1초 차이 등)은 그대로 유지한다. 테스트 의도가 5초 자체가 아니라 "유예 만료"이므로 기대값은 바꾸지 않는다.
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add backend/server
git commit -m "feat: keep disconnected waiting-room seats for five minutes"
```

---

### Task 2: 게임 중 자동 체크·폴드를 끊긴 지 30초 뒤로 미룬다

**Files:**
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/room/AutoPlay.java:37-56`
- Modify: `backend/server/src/main/java/xyz/jwlee/poker/server/room/RoomLifecycle.java:55-63` (PLAYING 분기)
- Modify: `backend/server/src/main/resources/application.yaml` (`e2e` 프로필)
- Test: `backend/server/src/test/java/xyz/jwlee/poker/server/room/AutoPlayTest.java`
- Test: `backend/server/src/test/java/xyz/jwlee/poker/server/DisconnectedTournamentHttpTest.java:173-174`

**Interfaces:**
- Consumes: Task 1의 `RoomEnv.grace().autoPlay()`.
- Produces: `AutoPlay.run(Room room, RoomEnv env)`의 시그니처는 그대로다(반환 `boolean`). 의미만 "행동자가 `autoPlay` 이상 끊겼을 때만 대신 행동"으로 바뀐다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`AutoPlayTest`, `MutableClock` 사용)

기존 테스트는 `Instant.EPOCH`에 끊고 시스템 시계로 판정하므로 이미 30초가 지난 상태로 간주되어 그대로 통과해야 한다. 새 테스트는 `MutableClock`과 그 시계로 만든 `GameFixture.started(3, 0, clock)`, `RoomEnv(clock, ids)`(DEFAULT 30초)를 쓰고, 끊김은 `RoomLifecycle.disconnected(f.room, "conn-" + who, env)`로 현재 시각에 기록한다.

```java
// 끊긴 지 30초가 안 된 행동자는 자동 처리하지 않는지 확인한다
@Test
void aFreshlyDisconnectedActorIsNotPlayedForYet() {
    // a 콜 후 b 차례에서 b를 방금 끊는다
    // AutoPlay.run(room, env) == false, actor == "b", automatic(f) 비어 있음
}

// 30초가 지나면 방 점검이 자동 처리하고 버전을 한 번 올리는지 확인한다
@Test
void theSweepPlaysForAnActorGoneForThirtySeconds() {
    // b 차례에 b를 끊고 clock.advance(29s) → sweep 후 actor == "b"
    // clock.advance(1s) → sweep 후 b 폴드, actor == "c", version == before + 1
}

// 유예 안에 돌아오면 자동 처리 없이 본인 차례로 남는지 확인한다
@Test
void aPlayerWhoReturnsWithinTheGraceActsThemselves() {
    // b 차례에 b 끊고 20초 → 다시 연결(RoomLifecycle.connected) → 20초 더 지나 sweep
    // actor == "b", automatic(f) 비어 있음
}

// 이미 30초 넘게 끊긴 사람에게 차례가 오면 그 명령 응답 안에서 바로 처리되는지 확인한다
@Test
void aLongGoneActorIsPlayedForInsideTheSameResponse() {
    // a 차례일 때 b를 끊고 31초 → a가 CALL → 응답 직후 b 폴드, actor == "c"
}

// 전원이 끊기면 30초가 지나도 점검이 진행하지 않는지 확인한다
@Test
void theSweepDoesNotPlayWhenNobodyIsConnected() {
    // 세 명 모두 끊고 60초 → sweep 후 actor 그대로, version 그대로
}
```

각 테스트의 단언은 위 주석에 적은 값 그대로 쓴다. `actor()`, `automatic(f)`, `f.send`, `f.check`는 기존 도우미다.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd backend && ./gradlew :server:test --tests "*AutoPlayTest"`
Expected: `aFreshlyDisconnectedActorIsNotPlayedForYet`, `theSweepPlaysForAnActorGoneForThirtySeconds`, `aPlayerWhoReturnsWithinTheGraceActsThemselves` FAIL.

- [ ] **Step 3: 구현한다**

`AutoPlay.shouldAct(Room room, RoomEnv env)`로 바꾸고, `actorGone` 판정을 "연결 없음"에서 "`presence().absentSince(actor)`가 있고 `now >= absentSince + env.grace().autoPlay()`"로 바꾼다. `someoneConnected` 판정은 그대로 둔다. 클래스 Javadoc의 설명도 30초 유예에 맞게 고친다.
`RoomLifecycle.sweep`의 `PLAYING, RESULT` 분기에서 방을 닫지 않는 경우 `if (room.phase() == RoomPhase.PLAYING && AutoPlay.run(room, env)) room.bumpVersion();`을 실행한다(방장 인수 판정과 순서는 상관없다).
`application.yaml`의 `e2e` 프로필에 `auto-play-grace-seconds: 2`를 추가한다.

- [ ] **Step 4: 실서버 흐름 테스트를 맞춘다**

`DisconnectedTournamentHttpTest.aSilentPlayerIsPlayedForByTheServerAndComesBackToActThemselves`에서 `passTime(Duration.ofSeconds(45), alice, carol);` 다음에 `passTime(Duration.ofSeconds(30), alice, carol);`를 추가한다(45초 무응답 판정 + 30초 유예). 이 테스트가 쓰는 프로필이 기본값 30초인지 확인한다.

Run: `cd backend && ./gradlew :server:test`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋한다**

```bash
git add backend/server
git commit -m "feat: wait thirty seconds before playing for a disconnected player"
```

---

### Task 3: 문서를 새 규칙에 맞추고 온라인 E2E로 확인한다

**Files:**
- Modify: `MULTIPLAYER_MODE.md` (87, 196, 211, 217, 227, 234, 260, 335, 344행 근처의 5초·"기다리는 시간은 없다" 서술)
- Modify: `SYSTEM_SPEC.md` (232, 242, 246, 264, 308, 321, 354행 근처)
- Modify: `ARCHITECTURE.md:618` (E2E는 `e2e` 프로필의 5초·2초 값으로 검사한다는 점)
- Modify: `frontend/e2e/online/reconnect.spec.ts:90` (테스트 이름·주석의 "five-second"는 e2e 프로필 값임을 밝힌다. 동작은 그대로)

- [ ] **Step 1: 문서를 고친다**

대기방 재접속 유예를 5분으로, 게임 중 자동 체크·폴드를 "끊김 판정 후 30초 유예, 차례마다 새로 세지 않음, 유예가 지난 뒤 차례가 오면 즉시"로 바꾼다. 무응답 끊김이면 자동 처리까지 최대 약 75초(45+30)가 걸린다는 점을 211행 근처에 적는다. 두 값이 `poker.waiting-reconnect-grace-seconds`, `poker.auto-play-grace-seconds` 설정이고 E2E는 5초·2초로 줄여 쓴다는 점을 적는다. 결정 기록(344행 근처)에 2026-11-14 변경을 한 줄 추가한다.

- [ ] **Step 2: 관련 온라인 E2E를 실행한다**

Run: `npm --prefix frontend run test:e2e:online -- reconnect.spec.ts waiting-room.spec.ts host-tools.spec.ts`
(로컬 E2E·빌드와 동시에 실행하지 않는다.)
Expected: 모두 PASS. `offline locks actions, exposes automatic play...`는 2초 유예 뒤 `Bob - 체크(자동)`가 보여야 통과한다.

- [ ] **Step 3: 커밋한다**

```bash
git add MULTIPLAYER_MODE.md SYSTEM_SPEC.md ARCHITECTURE.md frontend/e2e/online/reconnect.spec.ts
git commit -m "docs: describe the five-minute and thirty-second grace rules"
```
