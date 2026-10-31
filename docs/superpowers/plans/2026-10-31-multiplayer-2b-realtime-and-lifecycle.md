# 멀티플레이 계획 2B: 실시간 전달·연결 수명·기기 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자의 연결 상태를 서버가 판정하고, 방의 모든 변경을 WebSocket으로 전달하며, 끊긴 참가자 자동 처리·방장 이전·기기 복구·방 자동 삭제까지 서버에서 완성한다.

**Architecture:** 새 `realtime` 패키지가 WebSocket 연결과 전송을 맡고, 연결 판정과 시간 규칙은 `room` 패키지의 순수 Java 코드가 맡는다. 방 잠금 안에서 변경과 수신자별 메시지를 함께 확정하고, 잠금을 푼 뒤에 전송한다. 타이머는 1초 주기의 일괄 점검 하나이며, 마감 시각을 상태에서 계산하므로 오래된 타이머가 남지 않는다.

**Tech Stack:** Java 25, Spring Boot 4.1.2, Spring MVC + 가상 스레드, 기본 WebSocket(`spring-boot-starter-websocket`, STOMP 없음), Jackson 3, JUnit 5 + AssertJ + MockMvc, ArchUnit.

**Spec:** [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 5·6·8·10·12·13절, [SYSTEM_SPEC.md](../../../SYSTEM_SPEC.md) 3·8·9·10·14·15절(게임 흐름 표현은 MULTIPLAYER_MODE가 우선), TECH_DECISIONS T44~T47·T55~T57·T66~T70, [계획 2A](2026-10-30-multiplayer-2a-rooms-and-api.md)의 "2B로 넘기는 항목".

## 범위

| 포함 | 제외 |
|---|---|
| WebSocket 구독·SNAPSHOT·생존 확인, 연결 판정, 대기방 유예, 자동 체크/폴드, 방장 기권 처리, 방장 자동 이전·60초 인수, 기기 복구, 30분 삭제, 승자 초안 전파, 스트림 닫기, 세션 만료 시 연결 폐기 | 온라인 화면(계획 3), 요청 빈도 제한·서버 전체 세션 한도·배포 게이트·실제 운영 측정(계획 4) |

## 이번에 확정한 결정 (2026-10-31 사용자 확정)

- **타이머:** 스케줄러 하나가 1초마다 모든 방을 방 잠금 안에서 점검한다. 판정은 최대 1초 늦을 수 있다.
- **자동 행동과 취소:** 자동 체크·폴드는 취소 스냅샷을 덮어쓰지 않는다. 직전 사람 행동을 취소하면 그 뒤의 자동 행동도 함께 복원하고, 아직 끊겨 있으면 다시 자동 처리한다. 직전 행동과 시간 차이가 있는 자동 행동에도 같은 규칙을 적용한다.
- **이벤트 전달:** `SNAPSHOT`에 직전 변경에서 생긴 이벤트를 함께 싣는다. 버전이 연속되지 않은 화면은 효과만 건너뛴다. 전체 기록은 계속 기록 API로 조회한다.
- **첫 연결 대기:** 방 생성·참가 뒤 첫 WebSocket 연결을 30초 기다린다. 한 번 연결한 뒤 끊긴 경우의 대기방 유예는 명세대로 5초다.

계획 작성 중 다음 사항도 정했다.

- 복구 신청 경로는 `POST /api/recovery-requests`다. 신청자는 roomId를 모르고 코드만 알기 때문이다.
- 연결 상태 전환과 인수 요청 열림은 방 상태 버전을 올린다. 화면은 낮거나 같은 버전을 버리므로, 버전을 올리지 않으면 이 변경을 받을 수 없다.
- 같은 `stateVersion`의 메시지는 `draftVersion`이 더 높을 때만 적용한다. 승자 초안은 상태 버전을 올리지 않기 때문이다.
- 세션과 자리의 연결은 `SeatBinding(participantId, credential)`로 바꾼다. 복구 승인이 `credential`을 교체하므로 옛 세션은 쿠키가 남아 있어도 자리에 접근할 수 없다.

## Global Constraints

- 시간 값(MULTIPLAYER_MODE 13절, SYSTEM_SPEC 9절): 생존 확인 15초, 무응답 판정 45초, 대기방 재접속 유예 5초, 방장 인수 요청 60초, 전원 미접속 삭제 30분, 복구 신청 5분. 코드에 상수로 한 번만 둔다.
- 제한값(SYSTEM_SPEC 15절): 수신 WS 4KiB, 참가자당 WS 4개, 서버 전체 WS 500개, 연결당 전송 256KiB, 전송 정체 10초, 복구 신청 자리당 3개.
- 연결당 전송은 진행 중 1개와 최신 스냅샷 1개만 유지하고 중간 스냅샷은 대체한다. `ACCESS_REVOKED`·`ROOM_GONE`·`PROTOCOL_INCOMPATIBLE`은 대체되지 않는다.
- 같은 참가자의 유효한 구독 연결이 하나라도 있으면 접속 중이다(C2). 조작 세대와 연결 판정은 서로 별개다.
- HTTP 조회만으로 접속 상태를 만들지 않는다. 생존 응답만으로 `stateVersion`을 올리지 않는다.
- 전송은 잠금 밖에서 한다. 전송 실패로 게임 변경을 되돌리지 않는다.
- 잠금 순서는 2A와 같다: 스트림 장부 → 공용 잠금 → 방 잠금 → 세션 모니터. 방 잠금을 잡은 채 공용 잠금을 부르지 않는다.
- 의존 방향: `api`·`auth`·`realtime` → `room`·`registry` → `game`·`game-json`. `room`·`registry`는 `realtime`·Spring Web·Spring WebSocket을 쓰지 않는다. `realtime`과 `api`는 서로 의존하지 않는다.
- 시간은 주입한 `Clock`으로만 읽는다. 시간 규칙 테스트는 시계를 직접 진행시킨다.
- 새 클래스·함수 위에는 역할을 설명하는 한글 주석을 한 줄 둔다. 작업마다 관련 검증 후 로컬 커밋하고, push·PR은 별도 요청이 있을 때만 한다.

## Review Focus

1. **옛 연결의 늦은 종료:** 재연결한 뒤 옛 소켓의 close가 도착해도 새 연결을 지우거나 방장 이전을 시작하면 안 된다(M07). → Task 2 `Presence` 테스트, Task 6 실제 소켓 테스트.
2. **아무도 없는 게임의 자동 진행:** 연결된 미탈락자가 없으면 자동 처리가 멈춰야 하고, 한 명이 돌아오면 이어져야 한다. → Task 3.
3. **삭제 직전 재접속:** 30분 판정과 재접속이 겹쳐도 방 잠금 안에서 현재 상태로 다시 판단해야 한다(M13). → Task 4 동시성 테스트.
4. **복구 후 옛 기기:** 승인 직후 옛 기기의 쿠키·소켓·늦은 명령이 모두 막혀야 한다(M10). → Task 7.
5. **느린 화면:** 전송이 멈춘 연결 하나가 방 잠금과 다른 참가자의 전송을 막으면 안 되고, 메모리도 늘지 않아야 한다(X06). → Task 6 `ConnectionTest`.

---

### Task 1: 엔진 자동 행동과 방장 기권 표시

**Files:**
- Modify: `backend/game/.../game/GameEngine.java`, `.../command/BettingCommands.java`, `.../command/ForfeitCommand.java`, `.../command/GameCommand.java`, `.../event/EventDetails.java`
- Modify: `backend/game-json/.../gamejson/EventJson.java`, `GameJson.java`
- Test: `backend/game/src/test/java/xyz/jwlee/poker/game/AutoActionTest.java`, `backend/game-json/src/test/java/xyz/jwlee/poker/gamejson/EventJsonTest.java`

**Interfaces:**
- Produces:
  - `GameEngine.autoAct(GameState input, TransitionContext c): TransitionResult`: 현재 행동자를 콜 금액 0이면 CHECK, 아니면 FOLD로 처리한다.
  - `EventDetails.PlayerActed(ActionType action, String playerId, int additional, boolean automatic)`
  - `GameCommand.Forfeit(String playerId, boolean byHost)`, `EventDetails.PlayerForfeited(String playerId, boolean byHost)`
  - JSON `details.auto: true`, `details.byHost: true`는 참일 때만 쓴다. 기존 사례의 모양은 바뀌지 않는다.

- [ ] **Step 1: 실패 테스트 작성** (`AutoActionTest`)
  - 콜 금액 0이면 CHECK, 콜 금액이 있으면 FOLD이고 이벤트의 `automatic`이 참이다.
  - 사람 행동 A 뒤 자동 행동을 적용해도 `undo.state()`는 A 직전 상태이고, `undo.eventIds()`에 자동 행동의 이벤트가 덧붙는다.
  - `Undo`를 실행하면 A 직전으로 돌아가고 UNDO 이벤트의 `eventIds`에 자동 행동의 이벤트가 들어 있다.
  - `undo`가 null이면 자동 행동 뒤에도 null이다.
  - 자동 FOLD가 마지막 폴드가 되면 지급과 다음 핸드 블라인드까지 처리되고 칩 총량이 보존된다.
  - 행동자가 없는 정산 단계에서는 거절된다.
  - `EventJsonTest`: 자동 행동의 `details.auto`, 방장 기권의 `details.byHost`를 검사하고, 일반 행동에는 두 키가 없다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :game:test :game-json:test --tests '*AutoAction*' --tests '*EventJson*'` / Expected: 컴파일 실패
- [ ] **Step 3: 구현** `BettingCommands.act`에 `boolean automatic`을 추가한다. `autoAct`는 `transition`과 같은 복사·버전·불변식 경로를 쓰되 `isUndoable`을 적용하지 않고, 기존 `undo`가 있으면 이벤트 ID를 덧붙인 `UndoSnapshot`으로 교체한다. `GameJson.readCommand`의 `FORFEIT`은 `byHost=false`다.
- [ ] **Step 4: 통과 확인** Run: `backend/gradlew -p backend :game:test :game-json:test` / Expected: PASS, 기존 공통 사례 포함
- [ ] **Step 5: 커밋** `git commit -m "feat(game): add automatic actions and host-forfeit marks"`

### Task 2: 연결 모델과 시작 조건

**Files:**
- Create: `backend/server/src/main/java/xyz/jwlee/poker/server/room/Presence.java`, `RoomEnv.java`
- Modify: `.../room/Room.java`, `StartConditions.java`, `CommandPipeline.java`, `GameCommands.java`, `ResultCommands.java`, `WaitingRoomCommands.java`, `SnapshotWriter.java`
- Modify: `.../registry/RoomRegistry.java` (참가 시각 기록)
- Test: `.../room/PresenceTest.java`, `StartConditionsTest.java`, `CommandFixture.java`, `.../api/GameClient.java`, `FullTournamentHttpTest.java`

**Interfaces:**
- Produces:
  - `RoomEnv(Clock, IdGenerator)`: `TransitionContext transition()`, `String newId()`, `Instant now()`. 처리기 인자 `Supplier<TransitionContext>`를 이 타입으로 교체한다.
  - `Presence`: `void joined(String participantId, Instant now)`, `boolean attach(String participantId, String connectionId, Instant now)`(끊김→접속 전환이면 true), `boolean detach(String connectionId, Instant now)`(접속→끊김 전환이면 true), `boolean isConnected(String participantId)`, `Optional<Instant> absentSince(String participantId)`, `boolean neverConnected(String participantId)`, `int connectionCount(String participantId)`, `Map<String,String> subscribers()`(connectionId→participantId), `List<String> forget(String participantId)`(그 사람의 연결 ID를 돌려준다), `void restartAbsence(Instant now)`
  - `Room.presence()`. `Room.addParticipant`는 `Instant now`를 받아 `presence.joined`를 호출한다.

- [ ] **Step 1: 실패 테스트 작성** (`PresenceTest`)
  - 두 연결 중 하나를 끊어도 접속 중이고, `absentSince`가 비어 있다(M19).
  - 옛 연결의 `detach`가 새 연결에 영향을 주지 않는다(M07). 같은 연결의 `detach`를 두 번 불러도 전환은 한 번이다.
  - `joined` 직후 `neverConnected`가 참이고 첫 `attach`에서 거짓이 된다.
  - `restartAbsence`는 끊긴 사람의 시각만 새로 정하고 접속 중인 사람은 건드리지 않는다.
  - `StartConditionsTest`: 끊긴 참가자가 있으면 `NOT_CONNECTED`, 전원 접속이면 시작할 수 있다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*Presence*' --tests '*StartConditions*'` / Expected: 컴파일 실패
- [ ] **Step 3: 구현** `StartConditions.everyoneConnected`를 실제 판정으로 교체한다. `SnapshotWriter`의 `participants[]`에 `connected`를 추가한다.
- [ ] **Step 4: 테스트 도구 갱신** `CommandFixture`는 참가자마다 `room.presence().attach`를 호출한다. `GameClient.room(mvc, registry, names...)`는 참가 직후 테스트 연결을 붙인다. `FullTournamentHttpTest`도 임시로 레지스트리를 통해 연결을 붙이고, Task 8에서 실제 소켓으로 바꾼다.
- [ ] **Step 5: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS
- [ ] **Step 6: 커밋** `git commit -m "feat(server): track connections per participant"`

### Task 3: 자동 체크·폴드와 방장 기권 처리

**Files:**
- Create: `.../room/AutoPlay.java`
- Modify: `.../room/CommandPipeline.java`, `GameCommands.java`
- Test: `.../room/AutoPlayTest.java`, `GameCommandsTest.java`

**Interfaces:**
- Consumes: Task 1 `GameEngine.autoAct`, Task 2 `Presence`·`RoomEnv`.
- Produces: `AutoPlay.run(Room room, RoomEnv env): boolean`(게임이 바뀌면 true). 명령 `FORFEIT_DISCONNECTED {participantId}`(방장 전용).

규칙: `AutoPlay`는 방이 PLAYING이고 핸드가 BETTING이며 행동자가 끊겨 있고, 연결된 미탈락·미기권 참가자가 한 명 이상일 때 `autoAct`를 반복한다. `CommandPipeline`은 버전을 올리는 명령이 성공하면 버전을 올리기 전에 `AutoPlay.run`을 호출한다. 이렇게 하면 UNDO 뒤의 재처리와 자동 후속 처리가 같은 명령 결과에 포함된다. `FORFEIT_DISCONNECTED`는 진행 중에만, 대상이 방장 본인이 아니고 대상이 끊겨 있을 때만 적용한다. 대상이 다시 접속해 있으면 `TARGET_CONNECTED`, 게임에 없으면 `INVALID_INPUT`이다.

- [ ] **Step 1: 실패 테스트 작성** (`AutoPlayTest`)
  - 끊긴 사람 차례가 되면 명령 응답 안에서 체크되고, 콜 금액이 있으면 폴드된다. 기록 이벤트의 `automatic`이 참이다.
  - 끊긴 사람이 연속이면 연결된 사람 차례까지 이어서 처리한다.
  - 전원이 끊기면 멈추고 칩이 움직이지 않는다. 한 명이 돌아와 `AutoPlay.run`을 다시 호출하면 이어진다.
  - 정산 단계에서는 멈춘다.
  - 방장의 UNDO 뒤에도 끊겨 있으면 다시 자동 처리되고, 돌아왔으면 본인이 행동한다.
  - 방장이 끊겨도 같게 처리된다.
  - 자동 FOLD로 핸드가 끝나도 블라인드는 정상 납부되고 탈락시키지 않는다.
  - `GameCommandsTest`: 끊긴 사람의 방장 기권 처리는 성공하고 이벤트의 `byHost`가 참이다. 접속 중이면 `TARGET_CONNECTED`, 방장이 아니면 403, 기권 뒤 취소는 `UNDO_LOCKED`다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*AutoPlay*' --tests '*GameCommands*'` / Expected: FAIL
- [ ] **Step 3: 구현** 위 규칙대로 구현한다. `updateGame`으로 게임과 이벤트를 함께 반영한다.
- [ ] **Step 4: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(server): play disconnected seats and let the host forfeit them"`

### Task 4: 방 수명 점검과 방장 이전

**Files:**
- Create: `.../room/RoomLifecycle.java`
- Modify: `.../room/Room.java`, `CommandPipeline.java`, `WaitingRoomCommands.java`, `ResultCommands.java`, `Capabilities.java` 또는 `SnapshotWriter.java`
- Modify: `.../registry/RoomRegistry.java` (`sweepAll`)
- Test: `.../room/RoomLifecycleTest.java`, `.../registry/RoomSweepRaceTest.java`, 시계를 직접 진행하는 테스트 도구 `.../room/MutableClock.java`

**Interfaces:**
- Consumes: Task 2 `Presence`, Task 3 `AutoPlay`.
- Produces:
  - `RoomLifecycle.connected(Room, String participantId, String connectionId, RoomEnv)`: 전환이면 인수 요청을 닫고 버전을 올린 뒤 `AutoPlay.run`을 호출한다.
  - `RoomLifecycle.disconnected(Room, String connectionId, RoomEnv)`: 전환이면 버전을 올리고 `AutoPlay.run`을 호출한다.
  - `RoomLifecycle.sweep(Room, RoomEnv)`: 시간 규칙을 한 번 판정한다.
  - `RoomRegistry.sweepAll()`: `roomIds()`의 방마다 방 잠금 안에서 `sweep`을 실행한다. 사라진 방은 건너뛴다.
  - 명령 `TAKE_HOST {}`(대상 본인). 거절 코드 `HOST_TAKEOVER_CLOSED`(409), `FORBIDDEN`.
  - 스냅샷 `hostTakeoverOpen: boolean`, `you.canTakeHost: boolean`.

규칙:
- WAITING: 첫 연결 전이면 30초, 그 뒤 끊김이면 5초가 지난 참가자를 명단에서 뺀다. 빠진 사람이 방장이면 연결된 사람 중 입장 순서가 가장 빠른 사람이 방장이 된다. 연결된 사람이 없으면 남은 사람 중 입장 순서로 정한다. 명단이 비면 방을 닫는다.
- PLAYING·RESULT: 방장이 60초 이상 끊기면 `hostTakeoverOpen`을 열고 버전을 올린다. 방장이 돌아오면 닫고 버전을 올린다. 방장이 바뀌면 닫는다.
- `TAKE_HOST`: 요청이 열려 있고 요청자가 접속 중일 때만 성공한다. PLAYING이면 `canHoldRoom`도 만족해야 한다. 승자 초안은 `setHost`가 지운다.
- PLAYING·RESULT에서 전원이 끊긴 지 30분이 지나면 방을 닫는다. 판정은 현재 연결 기준이다.
- RE_READY: `presence.restartAbsence(now)`를 호출해 끊긴 사람에게 새 5초를 주고, 인수 요청을 닫는다(M21·M22). 이 호출은 상태 전환 때만 일어나므로 새로고침으로 유예가 늘지 않는다.

- [ ] **Step 1: 실패 테스트 작성** (`RoomLifecycleTest`, `MutableClock`으로 시간 진행)
  - 4.9초에는 남고 5초에 빠진다. 4.9초에 돌아오면 남는다.
  - 첫 연결 전 참가자는 29.9초에 남고 30초에 빠진다.
  - 방장이 빠지면 끊긴 사람을 건너뛰고 연결된 최초 입장자가 넘겨받는다. 다시 들어온 사람은 새 입장 순서를 받는다.
  - 마지막 사람이 빠지면 방이 닫힌다.
  - 방장 59.9초 끊김에는 요청이 없고 60초에 열린다. 복귀하면 닫힌다.
  - 수락 두 건 중 먼저 처리된 쪽만 방장이 되고 뒤의 요청은 `STALE_STATE` 또는 `HOST_TAKEOVER_CLOSED`다(M09). 탈락자는 PLAYING에서 거절되고 RESULT에서는 성공한다.
  - 결과 화면에서 1분 끊긴 사람이 있어도 RE_READY 직후에는 남고, 그 시점부터 5초 뒤 빠진다(M21). 같은 시점의 점검이나 재전송으로 유예가 다시 늘지 않는다(M22).
  - 전원 미접속 29분 59초에는 남고 30분에 닫힌다.
- [ ] **Step 2: 동시성 테스트 작성** (`RoomSweepRaceTest`) 30분이 지난 방에서 재접속과 `sweepAll`을 스레드로 100회 경합시킨다. 결과는 방이 남아 그 사람이 접속 중이거나 방이 사라진 경우 둘 중 하나여야 한다(M13).
- [ ] **Step 3: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*RoomLifecycle*' --tests '*RoomSweepRace*'` / Expected: FAIL
- [ ] **Step 4: 구현** 위 규칙대로 구현한다. 닫힌 방의 등록 제거는 `RoomDeletionRaceTest`와 같은 순서로 방 잠금 밖에서 한다.
- [ ] **Step 5: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS
- [ ] **Step 6: 커밋** `git commit -m "feat(server): expire absences, hand over the host and delete idle rooms"`

### Task 5: 변경 알림 수집

방 변경을 잠금 안에서 수신자별 메시지로 만들고, 잠금을 푼 뒤 넘기는 경로를 만든다. 이 작업에서 전송 구현은 없으며 테스트용 수집기로 검사한다.

**Files:**
- Create: `.../room/RoomPublisher.java`, `Publication.java`, `PublicationBuilder.java`, `EventView.java`
- Modify: `.../room/Room.java`, `SnapshotWriter.java`
- Modify: `.../registry/RoomRegistry.java`
- Modify: `.../api/CommandController.java`, `RoomController.java`, `HistoryController.java`
- Test: `.../room/PublicationBuilderTest.java`, `.../registry/RoomRegistryTest.java`

**Interfaces:**
- Produces:
  - `RoomPublisher.publish(Publication)`. 기본 구현은 아무 일도 하지 않는다. `RoomRegistry(IdGenerator, Clock, RoomPublisher)`.
  - `Publication(List<Delivery> deliveries, List<String> revokedConnections, List<String> goneConnections)`, `Delivery(String connectionId, ObjectNode message)`
  - `<T> T RoomRegistry.update(String roomId, Function<Room,T> action)`: 방 잠금 안에서 작업과 `PublicationBuilder.collect`를 실행하고, 잠금을 푼 뒤 `publish`와 닫힌 방 제거를 수행한다. 상태를 바꾸는 모든 경로는 이 메서드를 쓴다. `withRoom`은 읽기 전용으로 남긴다.
  - 메시지 `{type:"SNAPSHOT", previousVersion, events:[…], state}`. `state`는 기존 스냅샷이고 `draftVersion`을 항상 포함한다. 변경이 있는 수신자마다 자기 시점으로 만든다.
  - `EventView.write(GameEvent, long sequence): ObjectNode`: 기록 조회와 SNAPSHOT이 같은 이벤트 모양을 쓴다.
  - `Room.requestSnapshot(String connectionId)`: 구독·RESYNC처럼 버전 변화 없이 한 연결에 현재 상태를 보낼 때 쓴다. 이 메시지의 `previousVersion`은 null, `events`는 빈 배열이다.

규칙: `Room`은 마지막 수집 때의 버전과 `draftVersion`, 그 뒤 쌓인 이벤트를 기억한다. 둘 다 그대로이면 메시지를 만들지 않는다. 내보내기·나가기·방 닫기로 연결이 끊어져야 하면 `revokedConnections`·`goneConnections`에 넣는다.

- [ ] **Step 1: 실패 테스트 작성** (`PublicationBuilderTest`)
  - 명령 하나로 구독자마다 자기 `you`가 담긴 메시지가 하나씩 생기고, 수집 뒤 변경이 없으면 비어 있다.
  - `events`의 `sequence`가 기록 조회와 같고, `previousVersion`이 직전 수집 버전이다.
  - 승자 초안 저장은 `stateVersion`을 유지하고 `draftVersion`만 올리며 메시지가 나간다.
  - UNDO 메시지에 UNDO 이벤트가 포함된다.
  - 내보낸 사람의 연결은 `revokedConnections`에 들어가고 그 사람에게 SNAPSHOT이 가지 않는다.
  - 방이 닫히면 남은 연결이 `goneConnections`에 들어간다.
  - `RoomRegistryTest`: `publish`가 호출될 때 방 잠금이 풀려 있다(`room.lock().isHeldByCurrentThread()`가 거짓). `update`가 예외를 던져도 잠금이 풀린다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*PublicationBuilder*' --tests '*RoomRegistryTest*'` / Expected: FAIL
- [ ] **Step 3: 구현** `CommandController`의 `Done` 기록과 수동 `registry.remove`를 `update`로 대체한다. `create`·`join`도 알림을 보내도록 바꾼다. `HistoryController`는 `EventView`를 쓴다.
- [ ] **Step 4: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(server): collect room updates under the lock and publish after it"`

### Task 6: WebSocket 구독·전송·생존 확인

**Files:**
- Modify: `backend/server/build.gradle.kts` (`spring-boot-starter-websocket`, 테스트에서 점검 끄기 `systemProperty("poker.sweep.enabled", "false")`)
- Create: `.../auth/WebSocketHandshakeGuard.java`, `.../auth/SessionExpiryListener.java`
- Create: `.../realtime/RealtimeConfig.java`, `RoomSocketHandler.java`, `ConnectionHub.java`, `Connection.java`, `HeartbeatTask.java`, `SweepTask.java`
- Modify: `.../auth/SessionController.java`, `SessionIdentity.java`, `.../server/PokerServerApplication.java`(`@EnableScheduling`)
- Test: `.../realtime/ConnectionTest.java`, `RoomSocketHttpTest.java`, `HeartbeatTaskTest.java`, `.../auth/SessionControllerTest.java`, `.../ArchitectureTest.java`

**Interfaces:**
- Consumes: Task 4 `RoomLifecycle`, `sweepAll`, Task 5 `RoomRegistry.update`, `Publication`.
- Produces:
  - 경로 `/ws`. 클라이언트 메시지 `SUBSCRIBE {roomId, protocolVersion, lastSeenVersion}`, `PONG {nonce}`, `RESYNC {}`.
  - 서버 메시지 `SNAPSHOT`, `PING {nonce, stateVersion}`, `ACCESS_REVOKED {}`, `PROTOCOL_INCOMPATIBLE {}`, `ROOM_GONE {}`.
  - `DELETE /api/session/streams/{streamId}`: 204. 없는 스트림도 204이고 CSRF·Origin 검사는 그대로 받는다.
  - `Connection.offerSnapshot(ObjectNode)`, `offerFinal(ObjectNode)`, `Optional<Instant> sendingSince()`, `close()`. 연결마다 가상 스레드 하나가 전송한다.
  - `ConnectionHub implements RoomPublisher`.

규칙:
- 핸드셰이크: Origin이 없거나 허용 목록에 없으면 403이고, 세션이 없으면 401이다. 모든 연결은 `connectionId`를 서버에서 새로 발급한다.
- 구독: 한 연결은 한 방만 구독한다. 다른 방을 구독하면 연결을 닫는다. `registry.update` 안에서 자리 확인, 참가자당 4개 한도 확인, `RoomLifecycle.connected`, `requestSnapshot`을 실행하므로 구독과 초기 스냅샷 사이에 빈틈이 없다(M05).
- 거절: 방이 없고 세션에 그 방 연결이 있으면 `ROOM_GONE`, 자리 권한이 없으면 `ACCESS_REVOKED`, 규약이 다르면 `PROTOCOL_INCOMPATIBLE`을 보내고 닫는다. 서버 전체 500개를 넘으면 핸드셰이크 뒤 코드 1013으로 닫는다.
- 수신 4KiB를 넘거나 JSON이 잘못되면 연결을 닫는다. 잘못된 메시지로 게임 상태나 세션 만료를 바꾸지 않는다.
- 생존: 15초마다 PING을 보낸다. 마지막 PONG 뒤 45초가 지나면 닫는다. 전송이 10초 넘게 멈춘 연결도 닫는다. 닫힐 때 `RoomLifecycle.disconnected`를 호출한다.
- `SweepTask`는 `@ConditionalOnProperty("poker.sweep.enabled", matchIfMissing = true)`이고 1초 간격으로 `sweepAll`을 호출한다.
- 세션이 만료되면 `SessionExpiryListener`가 그 세션의 연결을 모두 `ACCESS_REVOKED`로 닫는다.
- 스트림 닫기는 장부를 제거한다. 스트림 ID는 다시 발급되지 않으므로 닫힌 스트림은 `UNKNOWN_STREAM`이다.

- [ ] **Step 1: 실패 테스트 작성** (`ConnectionTest`, 전송을 막을 수 있는 가짜 소켓 사용)
  - 전송이 막힌 동안 스냅샷을 100개 넣어도 대기열은 1개이고, 풀리면 최신 것만 나간다.
  - `offerFinal`은 대체되지 않고 그 뒤 스냅샷을 받지 않는다.
  - 256KiB를 넘는 메시지는 보내지 않고 연결을 닫는다.
  - 막힌 연결이 있어도 `ConnectionHub.publish`가 즉시 돌아온다.
- [ ] **Step 2: 실패 테스트 작성** (`HeartbeatTaskTest`, 시계 진행) 44.9초에는 유지되고 45초에 닫힌다. PONG을 받으면 기한이 늘지만 `stateVersion`은 그대로다. PING에 현재 `stateVersion`이 실린다. 10초 전송 정체도 닫힌다.
- [ ] **Step 3: 실패 테스트 작성** (`RoomSocketHttpTest`, 실제 포트)
  - 잘못된 Origin·Origin 없음·세션 없음은 핸드셰이크가 거절된다(M17).
  - 참가자가 구독하면 현재 SNAPSHOT을 받고, 다른 참가자의 명령 뒤 다음 SNAPSHOT과 이벤트를 받는다.
  - 소켓을 닫으면 다른 화면의 `participants[].connected`가 거짓이 된다. 곧바로 재연결한 뒤 옛 소켓 종료가 늦게 처리되어도 접속 중이다(M07).
  - 같은 참가자의 5번째 연결은 닫히고 기존 4개는 유지된다.
  - 4KiB를 넘는 메시지는 연결을 닫는다.
  - 내보낸 사람은 `ACCESS_REVOKED`, 방이 삭제되면 남은 사람은 `ROOM_GONE`을 받는다.
  - 세션을 무효화하면 연결이 닫힌다(X04).
  - `SessionControllerTest`: 스트림을 닫으면 그 ID의 요청이 `UNKNOWN_STREAM`이고 9번째 스트림을 다시 열 수 있다.
  - `ArchitectureTest`: `room`·`registry`·`support`가 `realtime`과 `org.springframework.web.socket..`을 쓰지 않고, `realtime`과 `api`가 서로 의존하지 않는다.
- [ ] **Step 4: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*realtime*' --tests '*Architecture*' --tests '*SessionController*'` / Expected: FAIL
- [ ] **Step 5: 구현** 위 규칙대로 구현한다. `spring-boot-starter-websocket` 버전은 Boot 관리 값을 쓴다.
- [ ] **Step 6: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS, 경고 없음
- [ ] **Step 7: 커밋** `git commit -m "feat(server): deliver room updates over WebSocket"`

### Task 7: 자리 자격과 기기 복구

**Files:**
- Create: `.../room/SeatBinding.java`, `RecoveryRequests.java`, `RecoveryCommands.java`
- Create: `.../api/RecoveryController.java`
- Modify: `.../room/Participant.java`, `Room.java`, `CommandPipeline.java`, `SnapshotWriter.java`
- Modify: `.../registry/RoomRegistry.java`, `.../auth/SessionIdentity.java`
- Modify: `.../api/RoomController.java`, `CommandController.java`, `HistoryController.java`, `ApiExceptionHandler.java`, `.../realtime/RoomSocketHandler.java`
- Test: `.../room/RecoveryCommandsTest.java`, `.../api/RecoveryApiTest.java`, `.../realtime/RecoverySocketHttpTest.java`

**Interfaces:**
- Produces:
  - `SeatBinding(String participantId, String credential)`, `Room.seatOf(SeatBinding): Optional<Participant>`(명단과 credential을 모두 확인한다). `SessionIdentity.bindingIn(roomId)`가 `participantIn`을 대체한다. `Participant`에 `credential`을 추가한다.
  - 모든 컨트롤러와 소켓 처리기는 방 잠금 안에서 `seatOf`로 자리를 확인하고, 없으면 `ROOM_NOT_FOUND`로 응답한다.
  - `POST /api/recovery-requests {protocolVersion, streamId, requestId, sequence, code, name}` → 201 `{recoveryRequestId, status:"PENDING", expiresAt}`. 세션 스트림 장부로 중복을 막는다.
  - `GET /api/recovery-requests/{id}` → `{recoveryRequestId, status}`. `status`는 `PENDING`·`APPROVED`·`REJECTED`·`EXPIRED`·`SUPERSEDED`다. `APPROVED`면 이 요청에서 세션을 연결하고 생성·참가와 같은 `{roomId, code, participantId, controlGeneration, state}`를 함께 준다.
  - 명령 `RECOVERY_APPROVE {recoveryRequestId}`, `RECOVERY_REJECT {recoveryRequestId}`(방장 전용).
  - 스냅샷 `recoveryRequests[{recoveryRequestId, participantId, name, requestedAt, expiresAt}]`. 방장에게만 채우고 나머지에게는 빈 배열이다.
  - 거절 코드 `RECOVERY_TARGET_NOT_FOUND`(404), `RECOVERY_LIMIT`(422), `ALREADY_PARTICIPANT`(422), `RECOVERY_NOT_PENDING`(422).

규칙:
- 신청은 신청 세션에 ID로 묶는다. 다른 세션이 조회하면 404다. 신청은 참가 권한이 아니므로 신청자는 방 상태를 읽을 수 없다.
- 이름은 공백 제거·NFC·대소문자 무시로 비교한다. 탈락한 자리도 복구할 수 있다.
- 승인: 방 잠금 안에서 방장 권한·대기 상태·만료·대상 자리를 다시 확인한다. 대상의 credential을 새로 발급하고 `advanceControl`로 조작 세대를 올린다. 대상의 기존 연결을 `revokedConnections`로 닫는다. 같은 자리의 다른 대기 신청은 `SUPERSEDED`가 된다. 버전을 올린다.
- 대상의 연결이 끊긴 시각은 승인 시각이 된다. 대기방이면 새 기기가 첫 연결을 하도록 30초 대기를 다시 적용한다.
- `RoomLifecycle.sweep`이 5분 지난 대기 신청을 `EXPIRED`로 바꾸고 버전을 올린다. 끝난 신청은 다시 5분 뒤 지운다.
- 복구는 연결·방장·칩·탈락 상태를 바꾸지 않는다. 방장 자리가 복구되어도 방장 지위는 유지한다.

- [ ] **Step 1: 실패 테스트 작성** (`RecoveryCommandsTest`)
  - 승인하면 옛 `SeatBinding`의 `seatOf`가 비고 새 binding만 통과하며 조작 세대가 1 올라간다.
  - 칩·탈락 상태·방장 지위는 그대로다.
  - 같은 자리의 신청 3개까지 받고 4번째는 `RECOVERY_LIMIT`이다.
  - 하나를 승인하면 나머지는 `SUPERSEDED`이고 다시 승인하면 `RECOVERY_NOT_PENDING`이다.
  - 5분 뒤 신청은 `EXPIRED`이고 승인할 수 없다.
  - 방장이 아니면 403이다. 방장의 스냅샷에만 신청이 보이고 세션 정보는 없다.
- [ ] **Step 2: 실패 테스트 작성** (`RecoveryApiTest`, `RecoverySocketHttpTest`)
  - 신청 재전송은 신청을 하나만 만든다.
  - 없는 이름은 404, 이미 그 방 참가자이면 `ALREADY_PARTICIPANT`다.
  - 다른 세션의 조회는 404, 대기 중 신청자의 `GET state`도 404다.
  - 승인 뒤 첫 조회가 세션을 연결하고, 응답을 잃은 뒤 다시 조회해도 같은 결과를 준다.
  - 옛 기기의 `state`·`history`·`commands`·`control`이 모두 404이고 옛 조작 세대 명령이 칩을 바꾸지 않는다(M10).
  - 옛 소켓은 `ACCESS_REVOKED`로 닫히고, 옛 쿠키로 다시 `SUBSCRIBE`해도 `ACCESS_REVOKED`다.
  - 방장을 인수한 사람이 끊긴 전 방장의 복구를 승인할 수 있다.
- [ ] **Step 3: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*Recovery*'` / Expected: FAIL
- [ ] **Step 4: 구현** 위 규칙대로 구현한다. `join`의 기존 참가자 복귀도 `seatOf`로 확인한다.
- [ ] **Step 5: 통과 확인** Run: `backend/gradlew -p backend :server:test` / Expected: PASS
- [ ] **Step 6: 커밋** `git commit -m "feat(server): recover a seat on a new device with host approval"`

### Task 8: 예시 계약·전체 흐름·문서

**Files:**
- Create: `shared/api-contract/ws-snapshot.json`, `ws-ping.json`, `ws-subscribe.json`, `ws-access-revoked.json`, `ws-room-gone.json`, `recovery-request.json`, `recovery-approved.json`
- Modify: `shared/api-contract/snapshot-*.json`, `README.md`, `backend/server/.../api/ApiContractTest.java`
- Modify: `backend/server/.../FullTournamentHttpTest.java`
- Create: `backend/server/.../DisconnectedTournamentHttpTest.java`
- Modify: `ARCHITECTURE.md`, `SYSTEM_SPEC.md`, `MULTIPLAYER_MODE.md`, `TECH_DECISIONS.md`, `IMPLEMENTATION_PROGRESS.md`

- [ ] **Step 1: 실패 테스트 작성**
  - `ApiContractTest`: 새 예시와 실제 메시지·응답의 필드가 같다. 새 필드 `connected`·`draftVersion`·`hostTakeoverOpen`·`canTakeHost`·`recoveryRequests`가 예시에 있다.
  - `FullTournamentHttpTest`: 임시 연결을 지우고 참가자 3명이 실제 WebSocket을 유지한 채 토너먼트 전체와 재시작을 진행한다. 화면마다 받은 마지막 SNAPSHOT이 `GET state`와 같은 버전이고 칩 총량이 보존된다.
  - `DisconnectedTournamentHttpTest`(`poker.sweep.enabled=true`, 시간 진행이 가능한 시계 빈): 한 사람이 끊겨 자동 처리되고 돌아와 이어서 행동한다. 방장이 끊겨 인수되고, 전 방장이 일반 참가자로 복귀한다. 끊긴 사람을 기권 처리해 토너먼트를 끝낸다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*ApiContract*' --tests '*TournamentHttp*'` / Expected: FAIL
- [ ] **Step 3: 예시와 테스트 완성** 2A와 같은 방식으로 실제 응답에서 예시를 만들고 diff를 검토한다.
- [ ] **Step 4: 문서 갱신**
  - `ARCHITECTURE.md`: `realtime` 패키지, 잠금·전송 경계, 경로, "이걸 바꾸려면" 행을 추가하고 2A의 미구현 안내를 지운다.
  - `SYSTEM_SPEC.md`: 6·14절의 2B 차이를 현재 코드로 고친다. 9절의 "자동 체크/폴드 없음"을 MULTIPLAYER_MODE 13절 기준으로 고친다. 복구 경로·SNAPSHOT 형식·첫 연결 30초를 기록한다.
  - `MULTIPLAYER_MODE.md`: 19절 C04·C05의 서버 구현 상태를 표시한다.
  - `TECH_DECISIONS.md`: T71 일괄 점검 타이머, T72 자동 행동과 취소 스냅샷, T73 SNAPSHOT의 이벤트 전달, T74 첫 연결 30초와 `SeatBinding`을 기록하고 목차를 갱신한다.
  - `IMPLEMENTATION_PROGRESS.md`: 2B 범위와 실제 검증 결과를 기록한다.
- [ ] **Step 5: 최종 검증** Run: `backend/gradlew -p backend test` / Expected: 전체 PASS, 경고 없음. 프런트 코드가 바뀌지 않았으면 프런트 검증은 생략하고 그 사실을 기록한다.
- [ ] **Step 6: 커밋** `git commit -m "test(server): cover real-time flows and update the multiplayer docs"`

## 계획 3으로 넘기는 항목

- `auto`·`byHost` 이벤트의 기록 문구(`OO - 폴드(자동)`, `OO - 기권(방장 처리)`)와 TS 이벤트 타입을 추가한다.
- 취소 알림 문구(`방장이 OO의 콜 50을 취소했습니다`)는 화면이 UNDO 이벤트의 `eventIds`와 받은 이벤트로 만든다.
- 화면은 `previousVersion`이 자기 버전과 같을 때만 효과를 재생하고, `(stateVersion, draftVersion)` 순서로 오래된 메시지를 버린다.
- 재연결 간격 1·2·4·8·최대 15초와 지터, 세션 갱신 6시간, 복구 결과 조회 주기, `shared/api-contract`의 TS 검사를 구현한다.
- REST의 `ROOM_GONE`(410)은 아직 없고 WS로만 알린다. 화면에서 구분이 필요하면 계획 3에서 추가한다.
