# 멀티플레이 계획 2A — 방·인증·REST 명령 서버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTTP만으로 방을 만들고 참가해 대기방부터 결과·다시 준비하기까지 한 토너먼트를 끝까지 진행할 수 있는 Spring Boot 서버를 만든다.

**Architecture:** `backend/server` Gradle 모듈(Spring Boot 4, Spring MVC, 가상 스레드)이 계획 1의 순수 규칙 모듈 `backend/game`을 호출한다. 방은 서버 메모리에만 있고, 같은 방의 요청은 방마다 하나인 잠금 객체로 하나씩 처리한다(공용 잠금 → 방 잠금 순서). 게임 상태는 프런트 TS `GameState`와 같은 JSON 이름으로 응답하며, 그 변환은 새 모듈 `backend/game-json` 한 곳에서만 한다.

**Tech Stack:** Java 25, Gradle 9.8.2 Kotlin DSL, Spring Boot 4.x(실행 시점 최신 안정판 고정), Spring MVC + 가상 스레드, Spring Security(HttpSession + 세션 저장 CSRF), Jackson, JUnit 5 + AssertJ + MockMvc, ArchUnit.

**Spec:** [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 5~12·14~15절, [SYSTEM_SPEC.md](../../../SYSTEM_SPEC.md) 6·7·10·14·15절(게임 흐름 표현은 MULTIPLAYER_MODE가 우선), TECH_DECISIONS T44~T47·T55~T57·T60~T70.

## 계획 2 구성

| 계획 | 범위 |
|---|---|
| **2A (이 문서)** | 서버 앱·세션·CSRF·Origin, 화면 스트림·요청 순번, 방 생성·참가·대기방, 게임 명령, 승자 선택 초안, 기권(본인), 중단, 결과·다시 준비하기, 조작 화면 인수, 기록 조회, API 예시 계약 |
| 2B (2A 이후 작성) | WebSocket 구독·상태 알림·생존 확인, 연결 판정·5초 유예·자동 체크/폴드(엔진 훅 포함), 방장 60초 인수·대기방 자동 이전, 끊긴 사람 방장 기권 처리, 기기 복구 신청·승인, 30분 방 삭제, 승자 선택 초안 실시간 전파 |
| 계획 4로 미룸 | 요청 빈도 제한(429), 배포 준비 게이트(종료 취소 거절 포함), 운영 쿠키 `__Host-` 실서버 적용 |

2A에서는 "연결 상태"를 아직 모른다. 그래서 시작 조건의 "명단 전원 연결"은 항상 참으로 두고, 2B에서 실제 판정으로 교체한다(교체 지점은 `room/StartConditions` 한 곳).

## Global Constraints

- 기술 결정(2026-10-30 사용자 확정, TECH_DECISIONS T66~T70): Spring Boot 4.x, Spring MVC + 가상 스레드, 방마다 `ReentrantLock` 하나(공용 → 방 순서), API 게임 상태는 TS `GameState`와 같은 JSON 이름, Java DTO와 TS 타입은 각자 손으로 쓰고 `shared/api-contract/`의 예시 JSON을 양쪽 테스트가 검사, API 테스트는 MockMvc 중심 + 쿠키·CSRF·Origin만 실제 HTTP.
- 코드 구조(MULTIPLAYER_MODE 15절): 책임 기준으로 나눈다. 의존 방향 `api`·`auth` → `room`·`registry` → `game`(+`game-json`). `game` 모듈은 JDK만 쓴다(T61). 서버 패키지 방향은 ArchUnit 테스트로 강제한다.
- 서버가 모든 금액·차례·권한·자격을 계산한다. 클라이언트가 보낸 잔액·팟·승자 자격을 믿지 않는다.
- 방: 최대 10개(대기·진행·결과 합계). 방 코드 6자리, 문자 집합 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(I·L·O·0·1 제외), 소문자 입력 허용(대문자로 정규화), 활성 방끼리 중복 금지.
- 참가: 대기방에서만, 2~10명, 이름 규칙은 계획 1 `SettingsValidator`와 동일(공백 제거·NFC·`^[가-힣a-zA-Z0-9 ]{1,10}$`·대소문자 무시 중복 금지).
- 권한: 베팅(체크·콜·베팅·레이즈·폴드·올인)은 현재 행동자 본인만. 설정·좌석·딜러·시작·블라인드 예약·취소·정산·승자 초안·중단·다시 준비·내보내기·방장 넘기기는 방장만. 이름 변경은 본인만(대기방). 기권은 본인만(2A), 방 나가기는 본인(대기방·결과 화면).
- 서버 정책: 콜 금액 0에서 폴드 거절(`INVALID_ACTION`). 종료 화면의 취소 허용(배포 게이트는 계획 4).
- 요청 처리 순서(SYSTEM_SPEC 7절): 형식·크기 → 방 조회 → 세션 참가자 확인 → 같은 스트림 중복 결과 확인 → 조작 세대 → 권한 → 토너먼트·핸드 범위 → 방 상태 버전 → 규칙 → 확정. 각 검사는 독립 단계이며 앞에서 막았다고 생략하지 않는다.
- 순번: 스트림마다 sequence 1부터, 최근 결과 64개, highWatermark는 스트림 수명 동안 유지. 같은 순번·다른 내용은 `REQUEST_CONFLICT`, 지난 순번은 `RESULT_EXPIRED`, 건너뛴 순번은 `SEQUENCE_GAP`. 검증된 비즈니스 거절도 순번을 소진한다.
- HTTP 코드(SYSTEM_SPEC 14절): 400 형식, 413 본문 32KiB 초과, 401 세션 없음, 403 CSRF·Origin·권한, 404 비참가자, 409 `STALE_STATE`·`CONTROL_LOST`·`REQUEST_CONFLICT`·`RESULT_EXPIRED`·`SEQUENCE_GAP`·`TOURNAMENT_CHANGED`·`PROTOCOL_INCOMPATIBLE`, 422 `INVALID_INPUT`·규칙 거절 코드, 503 방 한도.
- `protocolVersion` = 1. 다르면 409 `PROTOCOL_INCOMPATIBLE`.
- 시각은 주입한 `Clock`(UTC)으로, ID는 주입한 `IdGenerator`로 만든다. 테스트는 고정값을 쓴다.
- 작업마다 관련 검증 후 로컬 커밋. push·PR은 별도 요청 시에만.

## Review Focus

1. **같은 방 동시 요청**: 두 화면이 같은 상태 버전으로 동시에 명령하면 하나만 적용되고 다른 하나는 `STALE_STATE`여야 한다. → Task 10 동시성 테스트(스레드 20개).
2. **응답 유실 후 재전송**: 같은 requestId·sequence를 다시 보내면 상태를 다시 바꾸지 않고 처음 결과를 돌려줘야 한다(칩 이중 차감 금지). → Task 4 단위 + Task 6 API 테스트.
3. **다른 사람 대신 베팅**: 참가자가 행동자가 아닌데 `playerId`를 행동자로 바꿔 보내도 거절돼야 한다. → Task 7 `베팅은 행동자 본인만`.
4. **다시 준비하기 뒤 늦은 명령**: 이전 토너먼트의 tournamentId로 온 명령은 `TOURNAMENT_CHANGED`로 거절되고 새 게임에 섞이지 않아야 한다. → Task 8.
5. **방 한도 경합**: 10번째·11번째 방 생성이 동시에 오면 정확히 10개만 생겨야 한다. → Task 5 동시성 테스트.

---

### Task 1: `game-json` 모듈 — TS 이름 JSON 변환 한 곳으로

계획 1의 테스트 전용 `StateJson`을 서버도 쓰도록 독립 모듈로 옮긴다. `game` 모듈은 계속 JDK만 쓴다.

**Files:**
- Create: `backend/game-json/build.gradle.kts` (`java-library`; `api(project(":game"))`, `api("com.fasterxml.jackson.core:jackson-databind:2.20.0")`)
- Modify: `backend/settings.gradle.kts` (`include("game-json")`), `backend/game/build.gradle.kts` (test: `testImplementation(project(":game-json"))`, jackson 테스트 의존 제거 가능하면 제거)
- Move: `backend/game/src/test/java/.../fixtures/StateJson.java` → `backend/game-json/src/main/java/xyz/jwlee/poker/gamejson/GameJson.java` (패키지 변경, public API)
- Create: `backend/game-json/src/main/java/xyz/jwlee/poker/gamejson/EventJson.java`
- Create: `shared/game-fixtures/events.json` + schema 항목(suite `events`, id `EV01~`)
- Test: `backend/game-json/src/test/java/xyz/jwlee/poker/gamejson/EventJsonTest.java`, 기존 game 테스트는 import만 변경
- Modify: `backend/game/src/test/.../SettingsFixtureTest.java` (정규화 이름·오류 코드까지 검사), `frontend/tests/game/fixtureRunner.ts`(settings 사례의 `names`·`code` 기대값을 TS도 검사)

**Interfaces:**
- Produces: `GameJson.readState(JsonNode): GameState`, `GameJson.writeState(GameState): ObjectNode`, `GameJson.writeLegal(LegalActions): ObjectNode`, `GameJson.readCommand(JsonNode): GameCommand`, `EventJson.write(GameEvent): ObjectNode` — 이벤트 JSON은 `{id, at, tournamentId, hand, type, details, sequence?}`이고 details는 TS와 같다: `HAND_START {buttonSeat,sbSeat,bbSeat,sb,bb}`, 베팅 행동 `{playerId,additional}`, `RETURN {playerId,amount}`, `STREET {street}`, `REVEAL {showdown}`, `PAYOUT {pot,payouts}`, `ELIMINATED {playerId}`, `TOURNAMENT_END {winner}`, `BLINDS_SCHEDULED {sb,bb}`, `UNDO {eventIds}`, `ABORT {}`, 서버 전용 `FORFEIT {playerId}`, `FORFEIT_SPLIT {playerId,shares}`.

- [ ] **Step 1: 실패 테스트** — `EventJsonTest`: `events.json` 사례(TS 엔진이 실제로 내는 detail 모양을 TS 소스 `round.ts`·`commands/*.ts`의 `emit` 인자에서 손으로 옮긴 것)마다 Java 엔진으로 같은 명령을 적용해 `EventJson.write` 결과의 `type`·`details`가 사례와 같음. `SettingsFixtureTest`: 유효 사례는 정규화된 `names`, 무효 사례는 `code`(`INVALID_NAMES`·`INVALID_CHIP_SETTINGS`·`INVALID_SEATS`)까지 비교 — 사례 파일에 `expectedStateSubset.names`/`code`를 손으로 추가.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend test` / Expected: 컴파일 실패 또는 FAIL
- [ ] **Step 3: 구현** — 모듈 생성, `StateJson` 이동·이름 변경, `EventJson` 작성. game 테스트 import 갱신. TS 실행기도 settings 사례의 새 기대값을 검사.
- [ ] **Step 4: 통과 확인** — Run: `backend/gradlew -p backend test && npm --prefix frontend test -- --run` / Expected: 모두 PASS
- [ ] **Step 5: 커밋** — `git commit -m "refactor(game): move TS-name JSON mapping into a game-json module"`

### Task 2: 서버 모듈 골격·의존 방향 검사·CI

**Files:**
- Create: `backend/server/build.gradle.kts` (Spring Boot 4.x 플러그인·dependency-management; `implementation(project(":game-json"))`, `spring-boot-starter-web`, `spring-boot-starter-security`, `spring-boot-starter-validation`; test: `spring-boot-starter-test`, `spring-security-test`, `com.tngtech.archunit:archunit-junit5`)
- Modify: `backend/settings.gradle.kts` (`include("server")`), `.github/workflows/backend-ci.yml` (`./gradlew test` 전체)
- Create: `backend/server/src/main/java/xyz/jwlee/poker/server/PokerServerApplication.java`
- Create: `.../server/support/IdGenerator.java` (interface `String next()`; 기본 구현 `UUID.randomUUID()`), `.../server/support/TimeConfig.java` (`Clock` 빈, UTC)
- Create: `.../server/api/HealthController.java` — `GET /api/health` → `{"status":"UP","protocolVersion":1,"version":"<빌드 버전>"}`
- Create: `backend/server/src/main/resources/application.yaml` (`spring.threads.virtual.enabled: true`, `server.servlet.session.timeout: 7d`, `server.servlet.session.cookie.name: PCM_SESSION`, http-only, same-site lax; 프로파일 `prod`는 secure + 이름 `__Host-pcm-session`)
- Test: `.../server/ArchitectureTest.java`, `.../server/api/HealthControllerTest.java`

**Interfaces:**
- Produces: 패키지 `xyz.jwlee.poker.server.{api,auth,room,registry,support}`. ArchUnit 규칙: `room`·`registry`는 `api`·`auth`를 import하지 않는다, `room`·`registry`는 Spring Web(`org.springframework.web..`)·Servlet을 import하지 않는다, `support`는 다른 서버 패키지를 import하지 않는다.

- [ ] **Step 1: 실패 테스트** — `ArchitectureTest`(위 규칙), `HealthControllerTest`(MockMvc `GET /api/health` 200, `protocolVersion` 1).
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :server:test` / Expected: 컴파일 실패
- [ ] **Step 3: 구현** — 위 파일. Spring Boot 버전은 실행 시점 최신 안정 4.x를 공식 페이지에서 확인해 고정하고 T66에 기록.
- [ ] **Step 4: 통과 확인** — Run: `backend/gradlew -p backend test` / Expected: PASS, 경고 없음(`-Werror` 유지; Spring 관련 lint 경고가 불가피하면 그 경고만 좁혀 끄고 이유를 주석으로)
- [ ] **Step 5: 커밋** — `git commit -m "build: add the Spring Boot server module"`

### Task 3: 세션·CSRF·Origin·화면 스트림

**Files:**
- Create: `.../server/auth/SecurityConfig.java` — 모든 `/api/**` 허용(로그인 없음), CSRF는 `HttpSessionCsrfTokenRepository` + 헤더 `X-CSRF-TOKEN`, 폼 로그인·HTTP Basic 비활성, 인증 오류는 JSON(리다이렉트 금지)
- Create: `.../server/auth/OriginFilter.java` — GET·HEAD 외 요청은 `Origin`이 설정 `poker.allowed-origins` 중 하나여야 함, 없거나 다르면 403 `ORIGIN_REJECTED`
- Create: `.../server/auth/SessionController.java` — `GET /api/session` → `{csrfToken, protocolVersion}` (세션 생성, `Cache-Control: no-store`); `POST /api/session/streams` → `{streamId}` (세션당 활성 8개, 초과 409 `TOO_MANY_STREAMS`)
- Create: `.../server/auth/SessionIdentity.java` — 세션 속성 래퍼: `Set<String> streams()`, `Optional<String> participantIn(String roomId)`, `void bind(String roomId, String participantId)`, `void unbind(String roomId)`
- Test: `.../server/auth/SessionSecurityHttpTest.java` (`@SpringBootTest(webEnvironment = RANDOM_PORT)`, 실제 HTTP), `.../server/auth/SessionControllerTest.java` (MockMvc)

**Interfaces:**
- Produces: `SessionIdentity.from(HttpSession)`; 컨트롤러는 이것으로만 세션 속성을 읽고 쓴다. 화면 스트림마다 `RequestLedger`(Task 4)를 세션에 함께 둔다 — `RequestLedger ledgerFor(String streamId)`(등록 안 된 스트림은 409 `UNKNOWN_STREAM`). 방이 아직 없는 생성·참가 요청과 Task 9 화면 인수는 이 세션 스트림 장부를 쓴다. 이 단계에서는 장부를 저장할 자리만 만들고, 실제 사용은 Task 5·9에서 붙인다.

- [ ] **Step 1: 실패 테스트** — 실제 HTTP: ① `GET /api/session`이 `PCM_SESSION` 쿠키(HttpOnly, SameSite=Lax)와 `csrfToken`을 돌려줌 ② 같은 쿠키+토큰+허용 Origin으로 `POST /api/session/streams` 200 ③ 토큰 없음 403 ④ 다른 Origin 403 `ORIGIN_REJECTED` ⑤ 쿠키 없이 POST 401 또는 403(세션 없음). MockMvc: 스트림 9번째 409.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :server:test` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): add sessions, CSRF, origin check and screen streams"`

### Task 4: 요청 장부 — 순번·중복·결과 보관

**Files:**
- Create: `.../server/room/RequestLedger.java` — 스트림(또는 조작 세대) 하나의 순번 장부
- Create: `.../server/room/RequestOutcome.java` (record `String requestId, long sequence, Outcome outcome, String code, long resultStateVersion`; enum `Outcome { APPLIED, REJECTED }`)
- Test: `.../server/room/RequestLedgerTest.java`

**Interfaces:**
- Produces:
  - `RequestLedger.Check check(String requestId, long sequence, String fingerprint)` — 반환 sealed `Check`: `New`, `Replay(RequestOutcome)`, `Conflict`, `Expired`, `Gap`
  - `void record(RequestOutcome outcome, String fingerprint)` — 최근 64개 유지, `highWatermark = sequence`
  - fingerprint = 명령 본문(type·payload·tournamentId·handId·expectedStateVersion)의 정규화 JSON 문자열

- [ ] **Step 1: 실패 테스트** — 순번 1 New → record → 같은 ID·순번·지문 Replay(같은 결과) / 같은 순번 다른 지문 Conflict / 같은 ID 다른 순번 Conflict / 순번 3(다음은 2) Gap / 65개 기록 뒤 순번 1 Expired / 거절 결과도 record되어 highWatermark 증가.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :server:test --tests '*RequestLedger*'` / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): add the per-stream request ledger"`

### Task 5: 방 레지스트리·방 모델·생성·참가·조회

**Files:**
- Create: `.../server/registry/RoomRegistry.java` — 공용 잠금(`ReentrantLock`) 안에서 한도·코드·등록·삭제
- Create: `.../server/registry/RoomCodes.java` — `String next(Set<String> taken)`(SecureRandom, 위 문자 집합, 충돌 시 다시), `Optional<String> normalize(String input)`
- Create: `.../server/room/Room.java` — 방 하나의 모든 상태와 `ReentrantLock lock`; 필드: roomId, code, phase(`WAITING`·`PLAYING`·`RESULT`), version(long, 방 상태 버전, 감소 금지), participants(좌석 순 `List<Participant>`), hostId, settings(initial·sb·bb·button), lastStartSettings, game(`GameState` 또는 null), playerIds(participantId → `p{i}`), events(현재 토너먼트 `List<GameEvent>`), settlementDraft, ledgers(스트림·세대별 `RequestLedger`)
- Create: `.../server/room/Participant.java` (participantId, name, joinOrder, controlGeneration, forfeited 아님 — 게임 상태가 가짐)
- Create: `.../server/room/RoomSnapshot.java` + `.../server/room/SnapshotWriter.java` — 요청자별 스냅샷 JSON
- Create: `.../server/api/RoomController.java` — `POST /api/rooms`, `POST /api/room-joins`, `GET /api/rooms/{roomId}/state`
- Create: `.../server/api/ApiError.java` + `.../server/api/ApiExceptionHandler.java` — `{code, message}` 본문과 HTTP 코드 매핑(Global Constraints 표)
- Test: `RoomCodesTest`, `RoomRegistryTest`(동시 생성 한도), `RoomControllerTest`(MockMvc)

**Interfaces:**
- Produces:
  - 생성 요청 `{protocolVersion, streamId, requestId, sequence, name}` → 201 `{roomId, code, participantId, controlGeneration, state}`; 세션에 roomId→participantId 바인딩
  - 참가 요청 `{protocolVersion, streamId, requestId, sequence, code, name}` → 200 같은 모양. 거절: 코드 없음 404 `ROOM_NOT_FOUND`, 대기방 아님 422 `NOT_WAITING`, 정원 422 `ROOM_FULL`, 이름 규칙·중복 422 `INVALID_NAME`/`DUPLICATE_NAME`, 방 한도 503 `ROOM_LIMIT`
  - 스냅샷 `state` = `{roomId, code, roomPhase, stateVersion, tournamentId, settings{initial,sb,bb,button}, hostId, participants[{participantId,name,seat,playerId,isHost}], you{participantId, controlGeneration, capabilities{canAct,canUndo,canSettle,canEditSetup,canEditBlinds}}, game(GameJson.writeState 또는 null), legal(요청자가 행동자일 때 GameJson.writeLegal, 아니면 null), settlementDraft{draftVersion, potIndex, winners}|null}`
  - `RoomRegistry.withRoom(String roomId, Function<Room,T>)` — 방 잠금을 잡고 실행; 방 밖 공용 자료가 필요하면 반드시 `registry.withGlobal(...)` 안에서 방 잠금을 잡는다(역순 금지)
  - 생성·참가의 중복 확인은 세션 스트림 장부(Task 3 `ledgerFor`)로 한다. 생성은 공용 잠금 안에서, 참가는 공용 잠금(코드 조회) → 방 잠금 순서로 처리한다.
  - 세션에 바인딩돼 있어도 방 명단에 없는 참가자(내보내짐·나감)는 비참가자로 취급해 404를 돌려준다.

- [ ] **Step 1: 실패 테스트** — 코드: 31자 집합만 쓰고 소문자 정규화, 충돌 재시도. 레지스트리: 10개까지 생성, 11번째 503; 스레드 20개 동시 생성 → 정확히 10개. API: 생성 후 같은 세션으로 `GET state` 200(본인 `isHost`), 다른 세션 404, 두 번째 세션 참가 후 participants 2명·좌석 순 입장 순서, 같은 이름(대소문자만 다름) 422, 같은 생성 요청 재전송은 방을 하나만 만들고 같은 roomId 반환.
- [ ] **Step 2: 실패 확인** / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): create and join rooms"`

### Task 6: 명령 파이프라인과 대기방 명령

**Files:**
- Create: `.../server/room/CommandRequest.java` (record `int protocolVersion, String tournamentId, String requestId, long sequence, long controlGeneration, long expectedStateVersion, String handId, String type, JsonNode payload`)
- Create: `.../server/room/CommandPipeline.java` — Global Constraints의 검사 순서를 단계별 메서드로; 결과 `CommandResult(RequestOutcome outcome, Room room)`
- Create: `.../server/room/WaitingRoomCommands.java` — `SET_SETTINGS {initial,sb,bb}`, `SET_SEAT_ORDER {participantIds}`, `SET_DEALER {participantId}`, `RENAME {name}`, `KICK {participantId}`, `LEAVE {}`, `TRANSFER_HOST {participantId}`
- Create: `.../server/room/StartConditions.java` — `Optional<String> blockReason(Room)`: 인원 2~10, 딜러 지정, 설정 유효, 전원 연결(2A는 항상 참 — 2B 교체 지점, 주석으로 명시)
- Create: `.../server/api/CommandController.java` — `POST /api/rooms/{roomId}/commands`, `GET /api/rooms/{roomId}/requests/{requestId}`
- Test: `CommandPipelineTest`(단위, 가짜 Room), `WaitingRoomCommandsTest`, `CommandControllerTest`(MockMvc)

**Interfaces:**
- Consumes: Task 4 `RequestLedger`, Task 5 `Room`·`RoomRegistry`·`SnapshotWriter`.
- Produces: 응답 `{requestId, sequence, outcome, code, resultStateVersion, latestState}`(HTTP 200 APPLIED / 422·409 REJECTED). 성공한 모든 변경은 `room.version++`. 명령 타입 → 처리기 연결은 `CommandPipeline` 안의 `switch` 한 곳.

규칙: `SET_SETTINGS`는 계획 1 `SettingsValidator`의 금액 규칙(names는 현재 참가자 이름으로 채워 검증). `SET_SEAT_ORDER`는 현재 참가자 전원을 정확히 한 번씩 포함. `SET_DEALER`는 참가자 좌석 인덱스를 `settings.button`에 저장. 좌석 변경·참가·나가기·내보내기로 딜러가 사라지면 미선택(-1). `KICK`·`LEAVE`는 대기방에서만(`LEAVE`는 결과 화면도). 방장이 나가면 남은 사람 중 입장 순서가 가장 빠른 사람이 방장. 마지막 사람이 나가면 방 삭제. `TRANSFER_HOST`는 진행 중엔 미탈락자에게만(2A 대기방에선 누구나).

- [ ] **Step 1: 실패 테스트** — 파이프라인 단계 순서: 버전이 틀리고 권한도 없는 요청은 `FORBIDDEN`(권한 단계가 먼저), 재전송은 권한이 바뀌어도 이전 결과 반환(중복 확인이 먼저), 조작 세대가 다르면 `CONTROL_LOST`. 대기방 명령 각각의 성공·거절 사례(방장 아님 403, 잘못된 좌석 목록 422, 딜러 삭제 시 -1, 방장 나가면 승계, 마지막 사람 나가면 방 없음 404). API: `GET requests/{id}`가 저장된 결과를 돌려줌, 없으면 404.
- [ ] **Step 2: 실패 확인** / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): add the command pipeline and waiting-room commands"`

### Task 7: 게임 명령·기록 조회

**Files:**
- Create: `.../server/room/GameCommands.java` — `START`, 베팅 6종, `UNDO`, `SCHEDULE_BLINDS {sb,bb}`, `SETTLE_HAND {winners}`, `SETTLEMENT_DRAFT {potIndex, winners}`, `FORFEIT {}`, `ABORT {}`
- Create: `.../server/room/Capabilities.java` — `record Capabilities(boolean canAct, canUndo, canSettle, canEditSetup, canEditBlinds)`, `static Capabilities of(Room, String participantId)`
- Create: `.../server/api/HistoryController.java` — `GET /api/rooms/{roomId}/history?tournamentId=&after=0&limit=50` (limit 최대 100) → `{events:[EventJson…], nextAfter}`
- Test: `GameCommandsTest`, `CapabilitiesTest`, `HistoryControllerTest`

**Interfaces:**
- Consumes: `GameEngine.transition`, `Legal.of`, `Settlement.preview`, `Tournament.create`, `GameJson`, `EventJson`.

규칙:
- `START`(방장, 대기방): `StartConditions` 통과 → 좌석 순 이름으로 `Tournament.create(settings, ctx)` 후 `START_TOURNAMENT` 적용, `playerIds` 매핑 저장(좌석 i → `p{i}`), `lastStartSettings` 저장, phase `PLAYING`, 이벤트 기록 시작(이전 토너먼트 이벤트 버림).
- 베팅: 요청자의 playerId가 `game.hand.actorId`와 같아야 함(아니면 403 `NOT_YOUR_TURN`), payload의 playerId는 무시하고 요청자 것으로 채움. 콜 0에서 `FOLD`는 422 `INVALID_ACTION`.
- `UNDO`·`SCHEDULE_BLINDS`·`SETTLE_HAND`·`ABORT`: 방장만. `SETTLE_HAND`·`UNDO`·`ABORT` 성공 시 승자 초안 삭제.
- `SETTLEMENT_DRAFT`(방장, 정산 단계): `Settlement.preview` 없이 자격 검사만(선택한 승자가 해당 팟 자격자) 후 저장, `draftVersion++`, **방 상태 버전은 올리지 않는다**(MULTIPLAYER_MODE 8절). 방장 변경 시 초안 삭제.
- `FORFEIT`(본인, 진행 중): `GameCommand.Forfeit(playerId)` 적용.
- 엔진 결과가 `ENDED`·`ABORTED`면 phase `RESULT`. `UNDO`로 `ENDED`에서 돌아오면 `PLAYING`.
- 엔진 이벤트는 순번(1부터)을 붙여 `events`에 추가. 기록 조회는 tournamentId가 현재와 다르면 410 `TOURNAMENT_CHANGED`.

- [ ] **Step 1: 실패 테스트** — 3인 방 생성·참가·딜러·시작 → 블라인드 납부 확인(팟 15), 행동자 아닌 참가자 베팅 403(payload playerId를 행동자로 위조해도), 콜 0 폴드 422, 방장 아닌 UNDO 403, 정산 단계 초안 저장 시 stateVersion 불변·draftVersion 증가, 잘못된 자격자 초안 422, WIN으로 다음 핸드, 마지막 1명 → phase RESULT, RESULT에서 UNDO → PLAYING, 본인 기권, ABORT → RESULT. 기록: 커서 50/100 제한, `nextAfter`, 다른 tournamentId 410. 역할별 Capabilities 표(방장 행동자/방장 비행동자/참가자 행동자/참가자 비행동자/결과 화면).
- [ ] **Step 2: 실패 확인** / FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): run game commands and serve history"`

### Task 8: 결과 화면·다시 준비하기

**Files:**
- Modify: `.../server/room/GameCommands.java` 또는 Create `.../server/room/ResultCommands.java` — `RE_READY {}`
- Test: `ResultCommandsTest`

규칙(MULTIPLAYER_MODE 12절): 방장만, phase `RESULT`에서만(진행 중이면 422 `ABORT_FIRST`). 유지: 코드·참가자·이름·좌석·방장·조작 세대. 설정 = `lastStartSettings`(게임 중 올린 블라인드 아님). 초기화: game=null, 딜러 -1, events 비움, 승자 초안 null, phase `WAITING`. `room.version`은 계속 증가. 이후 이전 tournamentId를 담은 명령은 `TOURNAMENT_CHANGED`.

- [ ] **Step 1: 실패 테스트** — 종료 후 RE_READY: 설정이 시작 당시 값(중간에 블라인드 예약을 바꿨어도), 딜러 -1, 참가자·방장 유지, 버전 증가. 진행 중 RE_READY 422. 방장 아님 403. RE_READY 뒤 이전 tournamentId로 CALL → 409 `TOURNAMENT_CHANGED`(Review Focus 4). 결과 화면 LEAVE 허용.
- [ ] **Step 2~4** — 실행·구현·통과
- [ ] **Step 5: 커밋** — `git commit -m "feat(server): return to the waiting room after a result"`

### Task 9: 조작 화면 인수(같은 참가자의 다른 화면)

**Files:**
- Modify: `.../server/room/CommandPipeline.java` — 세션 스트림으로 오는 `TAKE_CONTROL {expectedControlGeneration}` 처리
- Modify: `.../server/api/CommandController.java` — `POST /api/rooms/{roomId}/control` (본문: streamId·requestId·sequence·expectedControlGeneration)
- Test: `ControlTakeoverTest`

규칙(SYSTEM_SPEC 14절 순번·인수): 같은 참가자(세션 바인딩)만, 방 잠금 안에서 `expectedControlGeneration == 현재`일 때만 `controlGeneration+1`. 동시 인수 둘 중 하나만 성공(나머지 409 `CONTROL_LOST`). 이전 세대의 게임 명령은 409 `CONTROL_LOST`. 새 세대의 장부는 순번 1부터.

- [ ] **Step 1~5** — 위 규칙의 테스트(동시 인수 스레드 2개 포함) → 구현 → 커밋 `feat(server): let a participant take control on another screen`

### Task 10: API 예시 계약·전체 흐름·동시성·문서

**Files:**
- Create: `shared/api-contract/README.md`(형식 설명), `shared/api-contract/*.json` — 생성·참가 요청/응답, 명령 요청/응답(APPLIED·REJECTED 각 1), 스냅샷(대기방·진행·정산·결과), 기록 응답, 오류 본문
- Create: `backend/server/src/test/java/.../server/api/ApiContractTest.java` — 각 예시를 DTO로 읽고 다시 써서 같은 JSON인지(필드 누락·이름 오류 검출)
- Create: `.../server/FullTournamentHttpTest.java` — 실제 HTTP, 세션 3개: 생성·참가·딜러·시작 → 핸드 진행 → 정산 → 종료 → 결과 → RE_READY → 두 번째 시작
- Create: `.../server/room/RoomConcurrencyTest.java` — 같은 방, 같은 stateVersion으로 스레드 20개가 동시에 명령 → APPLIED 1개, 나머지 `STALE_STATE`, 칩 총량 보존
- Modify: `ARCHITECTURE.md`(서버 지도·의존 방향·실행법·"이걸 바꾸려면" 행), `SYSTEM_SPEC.md` 6·14절에 실제 경로·코드가 문서와 다른 곳 표시, `IMPLEMENTATION_PROGRESS.md`, `MULTIPLAYER_MODE.md` 19절(C02·C03 진행 상태)

- [ ] **Step 1: 실패 테스트** — 위 세 테스트.
- [ ] **Step 2: 실패 확인** / FAIL
- [ ] **Step 3: 구현·문서**
- [ ] **Step 4: 최종 검증** — Run: `backend/gradlew -p backend test && npm --prefix frontend test -- --run` / Expected: 모두 PASS, 경고 없음
- [ ] **Step 5: 커밋** — `git commit -m "test(server): add API contract examples and a full HTTP tournament"`

## 2B로 넘기는 항목

- 엔진 훅: 자동 체크·폴드가 방장의 취소 스냅샷을 덮어쓰지 않게(계획 1 인계).
- `StartConditions`의 전원 연결 판정을 실제 연결 상태로 교체.
- 승자 선택 초안·상태 변경을 WebSocket으로 전파(2A는 조회 시점 스냅샷에 포함만).
- 방장의 끊긴 사람 기권 처리(`FORFEIT_DISCONNECTED`), 기기 복구 신청·승인, 대기방 5초 유예·방장 자동 이전, 진행·결과 방장 60초 인수, 30분 삭제.
- TS 쪽 `shared/api-contract` 검사는 계획 3에서 TS 타입과 함께 추가.
