# 멀티플레이 계획 1 — 서버 게임 규칙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 기기 TypeScript 규칙 엔진과 같은 결과를 내는 순수 Java 게임 규칙 모듈을 만들고, 두 엔진이 같은 공통 JSON 사례로 검증되게 한다.

**Architecture:** `backend/game` Gradle 하위 모듈에 Spring 의존성 없는 순수 Java 규칙을 둔다. 파일·함수는 `frontend/src/game/`과 1:1로 대응시키고(명령마다 상태를 깊은 복사한 뒤 복사본을 수정), 이름만 Java답게 풀어 쓴다. 공통 사례(`shared/game-fixtures/`)는 시작 상태를 완전한 GameState JSON으로 바꿔 두 언어의 실행기가 해석 로직 없이 읽게 한다.

**Tech Stack:** Java 25 (Gradle toolchain), Gradle 9.x Kotlin DSL, JUnit Jupiter, AssertJ, Jackson(테스트 전용). 프런트는 기존 Vitest.

**Spec:** [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) (2·9·10·14·15·19절), [GAME_SPEC.md](../../../GAME_SPEC.md) 4~8절, [SINGLE_DEVICE_MODE.md](../../../SINGLE_DEVICE_MODE.md) 6절.

## 멀티플레이 계획 구성

| 계획 | 범위 | 상태 |
|---|---|---|
| **1. 서버 게임 규칙 (이 문서)** | 예전 공개 명령 제거, 공통 사례 전체 상태화, Java 규칙 모듈, 기권 | 작성 |
| 2. 방·API·인증·실시간 서버 | Spring Boot 앱, 방 레지스트리·잠금, 요청 순번, REST, WebSocket, 연결 수명·자동 체크/폴드, 방장 이전, 복구 | 계획 1 완료 후 작성 |
| 3. 온라인 화면 | `features/online-game`, GameSession 온라인 구현, 대기방·결과 화면, manifest scope | 계획 2 API 확정 후 |
| 4. 백엔드 배포·운영 | 백엔드 이미지·EC2 Compose, 도메인 HTTPS, 배포 게이트, 부하 시험 | 계획 2 이후 |

각 계획을 쓸 때 그 범위의 기술 선택(방 잠금 방식, 타이머, 타입 공유, 온라인 E2E 등)을 사용자에게 먼저 묻는다.

## Global Constraints

- 기술 결정(2026-10-29 사용자 확정, TECH_DECISIONS T60~T65): Java 25 LTS, Gradle Kotlin DSL, 규칙은 별도 모듈 `backend/game`(Spring 의존성 없음), 공통 사례는 완전한 상태 JSON, 상태는 깊은 복사 후 수정, Java 필드는 풀어 쓴 이름, 이벤트는 종류별 sealed record, 기권은 서버 전용, 예전 공개 명령은 양쪽에서 제거.
- 코드 구조 원칙: MULTIPLAYER_MODE.md 15절 — 책임 기준으로 나누고, 같은 이유로 바뀌는 코드는 함께 둔다.
- `game` 모듈 main 소스는 JDK 외 의존성 0개. 시간·난수·ID 생성 호출 금지(모두 `TransitionContext`로 전달).
- 금액은 `int`, 5의 배수, 설정 상한 1,000,000, 전체 최대 10,000,000. 인원 2~10.
- 이름 규칙: 앞뒤 공백 제거·NFC 정규화 후 `^[가-힣a-zA-Z0-9 ]{1,10}$`, 대소문자 무시 중복 금지.
- 식별자 형식은 TS와 동일: 플레이어 `p{i}`, 핸드 `{ctx.id}:hand:{n}`, 이벤트 `{ctx.id}:{index}`.
- 이벤트 종류 문자열은 TS와 동일: `HAND_START`, `CHECK`, `CALL`, `BET`, `RAISE`, `FOLD`, `ALL_IN`, `RETURN`, `REVEAL`, `STREET`, `PAYOUT`, `ELIMINATED`, `TOURNAMENT_END`, `BLINDS_SCHEDULED`, `UNDO`, `ABORT` + 서버 전용 `FORFEIT`, `FORFEIT_SPLIT`.
- 거절 코드는 TS `RuleErrorCode`와 동일한 문자열.
- 공통 사례의 기대값은 손으로 계산한 값이다. 구현 결과로 기대값을 생성·수정하지 않는다. 사례와 구현이 다르면 멈추고 사용자에게 보고한다.
- 작업마다 관련 검증 후 로컬 커밋(AGENTS.md). push·PR은 별도 요청 시에만.

## Review Focus

1. **복사 누락으로 입력 상태 오염**: `pending`·`setupOrder`·승자 목록·취소 스냅샷 같은 중첩 목록을 얕게 복사하면 거절된 명령이 원본을 바꾼다. → Task 4 실행기가 모든 명령 전후로 입력 상태 JSON이 같은지 검사.
2. **취소 스냅샷 안의 스냅샷**: 스냅샷에 이전 `undo`가 남으면 두 번 연속 취소가 된다. → Task 3 `UNDO01` 사례(두 번째 취소는 `UNDO_LOCKED`).
3. **지급 맵 순서**: `Map` 순회 순서가 플레이어 순서와 다르면 이벤트 내용과 잔여 칩 수령자가 달라진다. → Task 7에서 `LinkedHashMap`(좌석 순) 사용, 잔여 칩 수령자 사례(W08~W10)로 검사.
4. **기권으로 자격자가 없는 팟**: 어떤 납부 층을 낸 사람이 모두 폴드(기권 포함)하면 그 층을 받을 사람이 없다 — 승자 선택 중 기권, 한 핸드 여러 명 기권, 올인한 사람의 베팅 중 기권. → Task 9 `FF05`·`FF08`~`FF10`(2026-10-30 규칙: 그 층에 낸 사람 각자에게 낸 만큼 반환, 기권자 몫은 핸드 후 생존자 균등 분배; 라운드가 닫히는 모든 곳에서 적용).
5. **빈 버튼 자리에서의 잔여 칩 순서**: 버튼이 탈락자 자리여도 "버튼 다음 자리부터"를 좌석 번호로 계산해야 한다. → Task 7 W09 + Task 9 `FF04`(기권 분배 잔여).

---

### Task 1: 프런트에서 예전 카드 공개 명령 제거

**Files:**
- Modify: `frontend/src/game/types.ts` (Phase, GameCommand)
- Modify: `frontend/src/game/commands/flow.ts` (beginReveal·advance·resumeFlow 삭제)
- Modify: `frontend/src/features/local-game/hooks/useLocalSession.ts:180-186` (복원 시 RESUME_FLOW 호출 삭제)
- Modify: `frontend/src/features/local-game/storage/restore.ts:77` (허용 phase에서 `revealPending`·`revealed` 제거)
- Modify: `frontend/src/features/gameplay/model/capabilities.ts` (주석 "reveal, resume, abort" → "abort")
- Test: `frontend/tests/game/automatic.test.ts`, `frontend/tests/game/invariants.test.ts:70-71`, `frontend/tests/gameplay/capabilities.test.ts:42`, `frontend/tests/local-game/restore.test.ts`, `frontend/e2e/app-flow.spec.ts:155`

**Interfaces:**
- Produces: `Phase = 'betting' | 'settlement'`, `GameCommand`에서 `BEGIN_REVEAL | ADVANCE_STREET | RESUME_FLOW` 제거. 이후 Java 포팅의 기준.

- [ ] **Step 1: 실패 테스트 작성** — `restore.test.ts`에 `it('예전 공개 단계 저장은 지원하지 않는 형식으로 원본을 보존한다')`: `hand.phase = 'revealPending'`인 저장 데이터를 복원하면 기존 "지원하지 않는 형식" 결과(현재 restore 실패 경로가 쓰는 결과 값 그대로)가 나오고 저장소 원본이 바뀌지 않음.
- [ ] **Step 2: 실패 확인** — Run: `npm --prefix frontend test -- --run tests/local-game/restore.test.ts` / Expected: 새 테스트 FAIL(지금은 phase 허용)
- [ ] **Step 3: 제거 구현** — 위 Files의 명령·phase·복원 분기를 삭제한다. `automatic.test.ts`의 '이전 저장의 공개 대기·공개 완료를 한 번 정규화' 테스트, `invariants.test.ts`의 reveal 분기, `capabilities.test.ts` 목록의 세 명령, `app-flow.spec.ts`의 구형 공개 상태 E2E는 삭제하거나 "복원 거절"을 기대하도록 바꾼다(E2E는 복구 화면이 뜨는지 확인).
- [ ] **Step 4: 검증** — Run: `npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test -- --run` / Expected: 전부 PASS. 이어서 관련 E2E만: `npm --prefix frontend run test:e2e -- app-flow.spec.ts storage.spec.ts` / Expected: PASS
- [ ] **Step 5: 문서** — SINGLE_DEVICE_MODE.md 8절의 "예전 `revealPending/revealed` 상태는 … 자동 진행 상태로 한 번 바꿔 저장한다"를 "예전 공개 단계 저장은 지원하지 않는 형식으로 취급한다(원본 보존, 새 토너먼트 선택)"로 수정.
- [ ] **Step 6: 커밋** — `git commit -m "refactor: drop the legacy card-reveal commands and phases"`

### Task 2: 공통 사례를 완전한 상태 JSON으로 변환

**Files:**
- Create (임시): `frontend/scripts/expand-fixtures.ts` — 기존 TS 해석기로 축약형을 완전한 상태로 바꿔 JSON을 다시 쓴다. 변환 후 삭제.
- Modify: `shared/game-fixtures/betting.json`, `pots.json`, `settlement.json`, `schema.json`
- Modify: `frontend/tests/game/betting.test.ts`, `frontend/tests/game/settlement.test.ts` (해석기 삭제, 상태를 그대로 읽음)
- Create: `frontend/tests/game/fixtureRunner.ts` — 모든 공통 사례 실행을 한 곳에

**Interfaces:**
- Produces (공통 사례 형식 v2, Java 실행기가 그대로 따름):
  - `betting`: `initialState` = TS `GameState` 전체(필드명 TS 그대로). `commands` = 게임 명령. 기대: `expectedStateSubset`(상태 부분 일치), `expectedLegal`(합법 행동 부분 일치), `expectedError`.
  - `pots`: `initialState` = 반환 처리 **전** 정산 단계 `GameState`. `commands` = `[{"type":"RETURN_UNCALLED"},{"type":"BUILD_POTS"}]`. 기대: `returnAmount`, `amounts`, `eligible`(기존 키 유지).
  - `settlement`: `initialState` = 정산 단계 `GameState`, 선택적 `pots`(사용자 지정 팟 배열 `{id,amount,eligible}`; 기존 `source:"custom"` 대체). `commands` = `[{"type":"PREVIEW_SETTLEMENT","winners":{"pot0":["p0"],…}}]`(팟 id 키 맵). 기대: `ok`, `payouts`.
  - `settings`, `lifecycle`, `positions`: 형식 변경 없음.
  - 명령 단위 거절 기대: 명령 객체에 선택 필드 `"expectError": "<코드>"`가 있으면 그 명령은 거절되어야 하고 상태는 그대로 다음 명령으로 넘어간다(Task 3에서 사용).

- [ ] **Step 1: 해석기를 한 파일로 모으기** — `betting.test.ts`의 상태 구성 코드와 `settlement.test.ts`의 `potState`를 `fixtureRunner.ts`의 `legacyBettingState(f)`·`legacyPotState(f)`로 옮기고 기존 테스트가 그대로 PASS하는지 확인. Run: `npm --prefix frontend test -- --run tests/game` / Expected: PASS(64개 사례 포함)
- [ ] **Step 2: 변환 스크립트 실행** — `expand-fixtures.ts`가 위 두 함수로 각 사례의 `initialState`를 완전한 상태로 바꾸고, settlement의 `source` 참조와 `winners` 배열을 팟 id 맵으로 바꿔 JSON을 다시 쓴다. Run: `npx --prefix frontend tsx frontend/scripts/expand-fixtures.ts` / Expected: 3개 파일 갱신, `expectedStateSubset`·`expectedLegal`·`expectedError`·`amounts`·`eligible`·`ok`·`payouts`는 `git diff`에서 **한 글자도 바뀌지 않음**.
- [ ] **Step 3: 설명 정리** — 사례 `description`의 "카드 공개 시작 대기" 등 예전 흐름 표현을 현재 자동 진행에 맞게 고친다(기대값은 손대지 않음).
- [ ] **Step 4: 실행기 교체** — `fixtureRunner.ts`에 `runFixtureSuite(suite)`를 두고 각 suite를 v2 형식 그대로 실행(명령 전후 입력 상태 불변 검사, `assertInvariants`, 명령별 `expectError`). `betting.test.ts`·`settlement.test.ts`·`fixtures.test.ts`는 이를 호출만 한다. `legacy*` 함수와 변환 스크립트 삭제.
- [ ] **Step 5: schema 갱신** — `schema.json`에 suite별 `initialState`·`commands` 모양과 `expectError`, `pots` 필드를 반영. 실행기 테스트가 schema 검사도 한다.
- [ ] **Step 6: 검증** — Run: `npm --prefix frontend test -- --run && npm --prefix frontend run lint` / Expected: PASS, 공통 사례 64개 모두 실행됨(Vitest 출력에서 D/B/P/W/S/LIF id 확인).
- [ ] **Step 7: 커밋** — `git commit -m "test: store full game states in shared fixtures"`

### Task 3: TS 전용 규칙 테스트를 공통 사례로 옮기기

TS 테스트에만 있는 규칙 동작을 Java도 검증하도록 공통 사례로 옮긴다. 기대값은 기존 TS 테스트의 단언 값을 그대로 쓴다(새로 계산하지 않음).

**Files:**
- Modify: `shared/game-fixtures/lifecycle.json` (사례 추가), `shared/game-fixtures/schema.json` (id 패턴에 `UNDO|AUTO|SET` 추가)
- Create: `shared/game-fixtures/undo.json`
- Modify: `frontend/tests/game/automatic.test.ts`, `single-undo.test.ts`, `settlement.test.ts:56-132`, `setup.test.ts`, `positions-initial.test.ts` — 옮긴 테스트 삭제
- Modify: `frontend/tests/game/fixtureRunner.ts` (undo suite 등록)

**Interfaces:**
- Consumes: Task 2 형식 v2, 명령별 `expectError`.
- Produces: suite `undo`(UNDO01~UNDO05), lifecycle 추가 사례 `AUTO01~AUTO02`, `LIF06~LIF12`, `SET01~SET03`. 모두 `initialState` = 설정(lifecycle 형식) + 명령 순서.

- [ ] **Step 1: 옮길 목록 고정** — 다음을 사례로 작성: `automatic.test.ts` 2건 → AUTO01·AUTO02, `single-undo.test.ts` 5건 → UNDO01~UNDO05, `settlement.test.ts` 56~132행 7건 → LIF06~LIF12, `setup.test.ts` 3건 → SET01~SET03, `positions-initial.test.ts` 3건 → positions 사례 D13~D15(첫 핸드 블라인드 좌석). 상태 비교가 어려운 단언(기록 이벤트 id 목록 등)은 `expectedEvents`·`expectedStateSubset`으로 표현하고, 표현할 수 없는 단언이 있으면 TS 테스트로 남기고 목록에 이유를 적는다.
- [ ] **Step 2: 사례 실행 확인** — Run: `npm --prefix frontend test -- --run tests/game` / Expected: 새 사례 PASS, 옮긴 원래 테스트 삭제 후에도 테스트 수 감소분 = 추가 사례 수.
- [ ] **Step 3: 커밋** — `git commit -m "test: move TS-only rule cases into shared fixtures"`

### Task 4: Gradle 골격, 공통 사례 실행기, CI

**Files:**
- Create: `backend/settings.gradle.kts` (`rootProject.name = "poker-backend"`, `include("game")`, foojay toolchain resolver 플러그인)
- Create: `backend/build.gradle.kts` (공통: Java toolchain 25, UTF-8, `-Xlint:all -Werror`)
- Create: `backend/game/build.gradle.kts` (`java-library`; main 의존성 없음; test: JUnit Jupiter BOM, AssertJ, Jackson databind)
- Create: `backend/gradlew`, `backend/gradlew.bat`, `backend/gradle/wrapper/*`
- Create: `backend/.gitignore` (`.gradle/`, `build/`)
- Create: `backend/game/src/test/java/xyz/jwlee/poker/game/fixtures/FixtureFiles.java` — `shared/game-fixtures/*.json` 경로 해석·로드
- Create: `.../fixtures/JsonSubset.java` — Vitest `toMatchObject`와 같은 부분 일치
- Create: `.../fixtures/FixtureSchemaTest.java`
- Create: `.github/workflows/backend-ci.yml`

**Interfaces:**
- Produces: `FixtureFiles.load(String suite): List<JsonNode>`; `JsonSubset.assertMatches(JsonNode expected, JsonNode actual)` — 객체는 기대 키만 재귀 비교, 배열은 길이 동일 + 원소별 재귀, 원시값은 같음.

- [ ] **Step 1: Gradle wrapper 만들기** — 로컬에 Gradle이 없으므로 공식 배포본(작업 시점 최신 안정 9.x, Java 25 지원을 Gradle 호환표에서 확인)을 스크래치 폴더에 내려받아 `gradle wrapper --gradle-version <버전>`을 `backend/`에서 실행. 버전은 TECH_DECISIONS T60에 기록.
- [ ] **Step 2: 실패 테스트** — `JsonSubsetTest`: `{"a":1}`⊂`{"a":1,"b":2}` 통과, `[{}, {"x":1}]` vs `[{"y":0},{"x":1}]` 통과, 배열 길이 다르면 실패, `{"a":1}` vs `{"a":2}` 실패. `FixtureSchemaTest`: 7개 suite 파일을 모두 읽고 각 사례에 `id`·`suite`·`commands`가 있음.
- [ ] **Step 3: 실패 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: 컴파일 실패 또는 FAIL
- [ ] **Step 4: 구현** — `FixtureFiles`는 `backend/game` 기준 `../../shared/game-fixtures`를 찾되, 시스템 속성 `fixtures.dir`가 있으면 그것을 쓴다(Gradle `test { systemProperty("fixtures.dir", rootDir.resolve("../shared/game-fixtures")) }`).
- [ ] **Step 5: 통과 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: PASS. JDK 25가 없으면 toolchain이 자동으로 내려받는지 확인.
- [ ] **Step 6: CI** — `backend-ci.yml`: `pull_request`/`push`(main) 중 `backend/**`·`shared/game-fixtures/**` 변경 시, `actions/setup-java`(temurin 25) + `./gradlew :game:test`. 기존 `ci-images.yml`는 이미 모든 PR에서 프런트 검사를 하므로 공통 사례 변경도 TS로 검증된다(변경 불필요 — 확인만).
- [ ] **Step 7: 커밋** — `git commit -m "build: add Gradle backend with the shared fixture loader"`

### Task 5: 상태·명령·이벤트 타입, 설정 검증, 토너먼트 생성, 위치

**Files (모두 `backend/game/src/main/java/xyz/jwlee/poker/game/` 아래):**
- `model/GameSettings.java` (record: `List<String> names, int initial, int smallBlind, int bigBlind, int button`)
- `model/Player.java` (class, 아래 필드, `Player copy()`)
- `model/Hand.java` (class, `Hand copy()`)
- `model/GameState.java` (class, `GameState copy()` — 중첩 목록·스냅샷까지 깊은 복사)
- `model/Phase.java` (enum `BETTING, SETTLEMENT`), `model/TournamentStatus.java` (enum `SETUP, PLAYING, ENDED, ABORTED`)
- `model/Blinds.java` (record `smallBlind, bigBlind`), `model/UndoSnapshot.java` (record `GameState state, List<String> eventIds`)
- `model/TransitionContext.java` (record `String id, String at`)
- `command/GameCommand.java` (sealed interface + 중첩 record들)
- `event/GameEvent.java` (record `id, at, tournamentId, hand, EventDetails details`; `type()`은 `details.type()`)
- `event/EventDetails.java` (sealed interface + 종류별 record, 아래 표)
- `rule/RuleErrorCode.java` (enum, TS 문자열과 동일 이름), `rule/RuleViolation.java` (RuntimeException, `code()`), `rule/Rules.java` (`static void require(boolean ok)`, `require(boolean ok, RuleErrorCode code)`)
- `settings/SettingsValidator.java`, `settings/SettingsValidation.java` (sealed: `Valid(GameSettings)`, `Invalid(SettingsErrorCode)`)
- `Tournament.java` (`static GameState create(GameSettings, TransitionContext)`)
- `Positions.java` (`nextSeat(int from, boolean[] eligible)`, `nextPositions(boolean[] alive, SeatPositions prev)`, `initialBlindSeats(int button, boolean[] alive)`), `model/SeatPositions.java` (record `buttonSeat, sbSeat, bbSeat`)
- Test: `.../fixtures/StateJson.java` (TS 이름 JSON ↔ Java 모델 변환, **이름 대응은 이 파일 한 곳**), `SettingsFixtureTest.java`, `PositionsFixtureTest.java`, `CopyTest.java`

필드 대응(StateJson이 사용):

| TS/JSON | Java |
|---|---|
| `Player.B` / `H` | `roundBet` / `handTotal` |
| `actedAt` / `reopenAt` | `actedAtBet` (Integer, null 허용) / `reopensAt` |
| `Hand.W` / `R` | `currentBet` / `minRaise` |
| `sb` / `bb` | `smallBlind` / `bigBlind` |
| `actorId`, `pending`, `showdown`, `street`, `number`, `buttonSeat`… | 같은 이름 |
| `GameState.pot`, `initialTotal`, `setupOrder`, `pendingBlinds`, `undo` | 같은 이름 (`undo`는 `UndoSnapshot`) |
| `status`/`phase` 문자열 | enum (소문자 문자열 ↔ 대문자 상수) |

이벤트 종류(`EventDetails` record → `type()`): `HandStarted(buttonSeat,sbSeat,bbSeat,smallBlind,bigBlind)→HAND_START`, `PlayerActed(ActionType action, playerId, additional)→action.name()`, `UncalledReturned(playerId, amount)→RETURN`, `RoundClosed(showdown)→REVEAL`, `StreetStarted(street)→STREET`, `PotsPaid(pot, LinkedHashMap payouts)→PAYOUT`, `PlayerEliminated(playerId)→ELIMINATED`, `TournamentEnded(winner)→TOURNAMENT_END`, `BlindsScheduled(smallBlind,bigBlind)→BLINDS_SCHEDULED`, `ActionUndone(List eventIds)→UNDO`, `TournamentAborted()→ABORT`, `PlayerForfeited(playerId)→FORFEIT`, `ForfeitStackSplit(playerId, LinkedHashMap shares)→FORFEIT_SPLIT`.

명령(`GameCommand` record): `StartTournament`, `SetupUpdate(GameSettings settings, List<String> order /*nullable*/)`, `Check(String playerId)`, `Call(..)`, `Fold(..)`, `AllIn(..)`, `Bet(int additional, String playerId)`, `Raise(..)`, `SettleHand(Map<String,List<String>> winners)`, `ScheduleBlinds(int smallBlind, int bigBlind)`, `Undo`, `Abort`, `Forfeit(String playerId)`. `playerId`는 nullable(TS와 같이 생략 가능).

**Interfaces:**
- Produces: 위 타입 전부, `StateJson.read(JsonNode): GameState`, `StateJson.write(GameState): JsonNode`, `StateJson.command(JsonNode): GameCommand`, `StateJson.event(GameEvent): JsonNode`.

- [ ] **Step 1: 실패 테스트** — `SettingsFixtureTest`(@TestFactory, settings suite 7건: `SettingsValidator.validate(...) instanceof Valid == expectedStateSubset.ok`), `PositionsFixtureTest`(positions suite: 단계별 `nextPositions` 결과가 `expected`와 같음, D13~D15 포함), `CopyTest`(`copy()` 후 원본의 `pending`·`players`·`undo.state.players`를 바꿔도 복사본 불변), `StateJsonTest`(betting 사례 `initialState`를 read→write 하면 원래 JSON과 같음).
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: 컴파일 실패
- [ ] **Step 3: 구현** — TS `settings.ts`·`tournament.ts`·`positions.ts`를 그대로 옮긴다. 이름 검증은 `Normalizer.normalize(trim, NFC)` 후 정규식. `Tournament.create`는 잘못된 설정이면 `IllegalArgumentException(code)`(TS `throw Error(code)` 대응).
- [ ] **Step 4: 통과 확인** — Run: 위와 같음 / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): add state model, settings and seat positions"`

### Task 6: 합법 행동, 베팅, 라운드 진행, 불변식, transition

**Files:**
- Create: `LegalActions.java` (record: `Player actor, int callAdditional, int minRaiseAdditional, int maxAdditional, boolean canRaise, boolean canCheck, boolean canCall, LegalReasonCode reasonCode`) + `Legal.java` (`static LegalActions of(GameState)`)
- Create: `Round.java` (`pay`, `emit`, `returnUncalled`, `resolveRound`, `advanceStreet`, `finishRound`, `startHand`, `settle` — TS `round.ts` 대응)
- Create: `Invariants.java` (`static void check(GameState)` — 위반 시 `IllegalStateException(code)`, 코드 문자열은 TS와 같음)
- Create: `commands/CommandHandler.java` (`void apply(GameState s, C command, TransitionContext c, List<GameEvent> events)`), `commands/SetupCommands.java`, `commands/BettingCommands.java`
- Create: `GameEngine.java` (`static TransitionResult transition(GameState input, GameCommand cmd, TransitionContext c)`), `TransitionResult.java` (sealed: `Applied(GameState state, List<GameEvent> events)`, `Rejected(RuleErrorCode code)`)
- Test: `.../fixtures/FixtureRunner.java` (TS `fixtureRunner.ts` 대응), `BettingFixtureTest.java`

**Interfaces:**
- Consumes: Task 5 타입.
- Produces: `GameEngine.transition`, `Legal.of`, `Round.*`(Task 7·8·9가 사용). 명령 → 핸들러 연결은 `GameEngine` 안의 `switch (cmd)` 패턴 매칭(sealed라 누락 시 컴파일 오류). 취소 가능 명령: `Check, Call, Bet, Raise, Fold, AllIn, SettleHand`.

- [ ] **Step 1: 실패 테스트** — `FixtureRunner.run(JsonNode fixture)`: 각 명령마다 입력 상태 JSON 불변 확인, `expectError`/`expectedError`면 `Rejected(code)` 확인, 성공이면 `Invariants.check`, 마지막에 `expectedStateSubset`(StateJson.write 결과와 부분 일치)·`expectedLegal`(Legal 결과를 TS 이름 JSON으로)·`expectedEvents`(이벤트 type 포함) 확인. `BettingFixtureTest`는 betting suite 전체를 @TestFactory로 실행한다. lifecycle은 폴드 자동 지급·정산이 필요하므로 Task 7에서 실행기를 붙인다.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: FAIL
- [ ] **Step 3: 구현** — `legal.ts`, `round.ts`(settle 제외 부분), `commands/setup.ts`, `commands/betting.ts`, `invariants.ts`, `transition.ts`를 옮긴다. `transition`은 `input.copy()`에 적용, `RuleViolation`만 `Rejected`로 바꾸고 나머지 예외는 그대로 던진다. 버전은 `input.version + 1`. 취소 가능 명령이면 `undo = new UndoSnapshot(input.copy() with undo=null, 이벤트 id 목록)`.
- [ ] **Step 4: 통과 확인** — Run: 위와 같음 / Expected: betting 23건 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): add legal actions, betting and round progression"`

### Task 7: 팟·정산·다음 핸드

**Files:**
- Create: `Settlement.java` (`static List<Pot> buildPots(GameState)`, `static SettlementPreview preview(GameState, Map<String,List<String>> winners)`, `preview(GameState, Map, List<Pot>)`), `model/Pot.java` (record `id, amount, List<String> eligible`), `SettlementPreview.java` (record `boolean ok, LinkedHashMap<String,Integer> payouts, SettlementErrorCode error, List<PotAllocation> allocations`), `PotAllocation.java` (record `potId, amount, LinkedHashMap payouts, List<String> remainderRecipients`)
- Modify: `Round.java` (`settle`), `commands/FlowCommands.java` (create: `SettleHand`)
- Test: `PotsFixtureTest.java`, `SettlementFixtureTest.java`, `LifecycleFixtureTest.java`(새로 추가, lifecycle suite 전체)

**Interfaces:**
- Produces: `Settlement.buildPots`, `Settlement.preview`(계획 2의 방장 승자 초안 검증이 사용).

- [ ] **Step 1: 실패 테스트** — pots suite 7건(`RETURN_UNCALLED` 후 `returnAmount`, `BUILD_POTS` 후 `amounts`·`eligible`), settlement suite 10건(`PREVIEW_SETTLEMENT` 결과 `ok`·`payouts`, `pots` 지정 시 그 팟 사용), lifecycle suite 전체(Task 3 추가분 포함, `SCHEDULE_BLINDS`·`ABORT`가 들어간 사례는 Task 8까지 `@Disabled` 대신 suite 필터로 제외하고 제외 목록을 테스트 이름에 표시).
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: FAIL
- [ ] **Step 3: 구현** — `settlement.ts`를 옮긴다. 동률 일관성 검사의 union-find·순환 검사는 TS 그대로. 지급 맵은 플레이어 좌석 순 `LinkedHashMap`. 잔여 칩 순서는 `(seat - buttonSeat - 1 + n) % n` 오름차순.
- [ ] **Step 4: 통과 확인** — Run: 위와 같음 / Expected: pots·settlement·lifecycle 전체 PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): add pots, settlement and next-hand flow"`

### Task 8: 직전 행동 취소·블라인드 예약·중단

**Files:**
- Modify: `commands/FlowCommands.java` (`Undo`, `ScheduleBlinds`, `Abort`; TS `flow.ts`에서 Task 1 이후 남은 부분)
- Test: `UndoFixtureTest.java` (undo suite), `LifecycleFixtureTest`의 제외 필터 제거

**Interfaces:**
- Consumes: Task 6 `UndoSnapshot` 저장 규칙.
- Produces: 취소 규칙 — 종료 상태에서도 허용(`inPlay(s, allowEnded=true)`), 예약 블라인드는 같은 핸드면 현재 예약 유지·다른 핸드면 스냅샷 예약 복원, 버전은 되돌리지 않음.

- [ ] **Step 1: 실패 테스트** — undo suite UNDO01~UNDO05 + 기존 lifecycle의 예약·중단 사례.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: FAIL
- [ ] **Step 3: 구현** — `flow.ts`의 undo·scheduleBlinds·abort를 옮긴다.
- [ ] **Step 4: 통과 확인** — Run: 위와 같음 / Expected: 공통 사례 전체 PASS (TS와 같은 64+Task 3 추가 사례)
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): add undo, blind scheduling and abort"`

### Task 9: 기권 (서버 전용)

MULTIPLAYER_MODE.md 10절을 규칙으로 옮긴다. 공통 사례 파일 `forfeit.json`은 Java 실행기만 읽는다(TS `fixtureRunner.ts`는 이 suite를 등록하지 않음 — 파일 상단 `description`에 명시).

**Files:**
- Create: `shared/game-fixtures/forfeit.json` (suite `forfeit`, id `FF01`~`FF07`), schema에 suite 추가
- Modify: `model/Player.java` (`boolean forfeited`), `StateJson` (`forfeited` 필드, 없으면 false)
- Create: `commands/ForfeitCommand.java`
- Modify: `Round.java` (`settle`에서 기권자 스택 분배), `Round.returnOwnerless`(주인 없는 층 반환, 라운드가 닫히는 곳마다), `commands/ForfeitCommand.java`
- Test: `ForfeitFixtureTest.java`

**Interfaces:**
- Produces: `Forfeit(playerId)` 명령. 권한(본인/방장, 대상이 끊겨 있는지)은 계획 2의 방 계층이 검사하고, 규칙은 대상의 게임상 가능 여부만 본다.

규칙(사례 기대값의 근거):
- 거절: `status != PLAYING`(`INVALID_ACTION`), 대상 없음·이미 탈락·이미 기권(`INVALID_ACTION`).
- 처리: `forfeited = true`, `folded = true`, `pending`에서 제거, `undo = null`, 이벤트 `FORFEIT`. 단계가 `BETTING`이면 `Round.resolveRound(s, 현재 행동자 좌석 - 1)`로 차례를 다시 계산(행동자가 아니면 같은 행동자 유지, 행동자였으면 다음 사람). `SETTLEMENT`이면 남은 비폴드 생존자가 1명일 때 그 사람에게 전체 지급(`settle`).
- 핸드 종료(`settle`) 시: 지급을 반영한 뒤, 기권했고 아직 탈락하지 않은 사람마다 스택을 `생존자 = !eliminated && !forfeited && stack > 0`에게 5칩 단위로 균등 분배, 나머지는 버튼 다음 좌석 순(`FORFEIT_SPLIT`). 기권자 스택은 0이 되어 기존 탈락 처리로 `ELIMINATED`. 그 뒤 종료 판정.
- **주인 없는 층 (사용자 확정 2026-10-30, 10-29 규칙 대체)**: 어떤 납부 층을 낸 사람이 모두 폴드(기권 포함) 상태가 되면, 그 층은 **낸 사람 각자에게 낸 만큼** 돌려준다. 상한 `cap` = 남은 비폴드·미탈락 참가자의 최고 `handTotal`; `handTotal > cap`인 모든 참가자마다 차액을 스택에 더하고 `handTotal = cap`, `roundBet = min(roundBet, handTotal)`, 팟 감소, 이벤트 `RETURN {playerId, amount}`(좌석 순). 기권자에게 돌아간 칩은 핸드가 끝날 때 위 분배 규칙으로 생존자에게 균등 분배된다. 한 핸드 여러 명 기권이나 올인한 사람의 베팅 중 기권으로 베팅 단계에서도 생기므로 `Round.returnOwnerless`를 라운드가 닫히는 모든 곳(`resolveRound`의 마지막 1명 경로에서 미콜 반환 뒤, `finishRound`, 기권 처리의 승자 선택 경로)에서 호출한다. 기권이 없는 TS에서는 도달할 수 없으므로 Java에만 둔다(공통 사례 결과 불변). `buildPots`의 `NO_POT_ELIGIBLE` 예외는 안전장치로 유지한다.

- [ ] **Step 1: 사례 작성(손 계산)** — `FF01` 행동자 아닌 사람 기권: 차례 유지, 핸드 끝에 스택 분배. `FF02` 행동자 기권: 다음 사람 차례. `FF03` 2인 중 1명 기권: 즉시 상대 지급 → 기권자 탈락 → 토너먼트 종료, 남은 스택은 우승자에게. `FF04` 3명 생존, 분배 잔여 5칩: 버튼 다음 좌석부터. `FF05` 승자 선택 단계에서 사이드 팟 유일 자격자 기권(MULTIPLAYER_MODE 10절 예시: A 100 올인, B·C 300, B 폴드, C 기권): 사이드 400은 낸 만큼 B 200·C 200 반환(`RETURN` 2건, 2026-10-30 규칙), 메인 300은 A 단독 자격으로 자동 지급, 핸드 후 C 스택이 생존자(A·B)에게 균등 분배. `FF06` 정산 단계 기권으로 1명만 남음: 자동 지급. `FF07` 거절: 준비 단계·이미 탈락. (2026-10-30 추가) `FF08` 한 핸드 2명 기권으로 SB만 남음, `FF09` 기권 뒤 폴드가 라운드를 닫을 때 주인 없는 층, `FF10` 올인한 사람의 베팅 중 기권 + 콜이 라운드를 승자 선택으로 닫음, `FF11` 베팅 중 기권이 라운드를 닫아 2명 승자 선택. 각 사례에 계산 근거를 `description`에 적는다.
- [ ] **Step 2: 실패 확인** — Run: `backend/gradlew -p backend :game:test --tests '*Forfeit*'` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 규칙대로.
- [ ] **Step 4: 통과 확인** — Run: `backend/gradlew -p backend :game:test` / Expected: 전체 PASS. Run: `npm --prefix frontend test -- --run tests/game` / Expected: PASS(forfeit suite 미등록, schema만 통과)
- [ ] **Step 5: 커밋** — `git commit -m "feat(game): add server-only forfeit rule"`

### Task 10: 무작위 토너먼트 불변식 검사와 문서

**Files:**
- Create: `backend/game/src/test/java/xyz/jwlee/poker/game/RandomTournamentTest.java`
- Modify: `ARCHITECTURE.md` (백엔드 지도, 의존 방향, "이걸 바꾸려면 여기를 본다"에 서버 규칙 항목), `IMPLEMENTATION_PROGRESS.md` (계획 1 실행 기록), `MULTIPLAYER_MODE.md` 19절 C01 상태

**Interfaces:**
- Consumes: `GameEngine.transition`, `Legal.of`, `Settlement.buildPots`.

- [ ] **Step 1: 테스트 작성** — TS `invariants.test.ts`의 '결정적 2~10인 토너먼트'와 같은 방식(고정 시드 `java.util.Random(20261029)`, 인원별 반복): 매 단계 합법 행동 중 하나(가끔 기권 포함)를 고르고, 정산 단계에서는 첫 자격자를 승자로 선택. 모든 성공 전환 후 `Invariants.check` 통과, 입력 상태 불변, 2,000단계 안에 종료. 실패하면 시드·단계·명령을 메시지에 출력.
- [ ] **Step 2: 실행** — Run: `backend/gradlew -p backend :game:test` / Expected: PASS
- [ ] **Step 3: 문서** — ARCHITECTURE.md에 `backend/game` 패키지 표(model·command·event·rule·settings·commands + 최상위 GameEngine/Round/Legal/Settlement/Positions/Invariants)와 "TS 파일 ↔ Java 클래스" 대응표, 실행 명령, 공통 사례 형식 v2 설명을 추가. IMPLEMENTATION_PROGRESS.md에 작업별 검증 결과 기록.
- [ ] **Step 4: 최종 검증** — Run: `backend/gradlew -p backend :game:test && npm --prefix frontend run typecheck && npm --prefix frontend run lint && npm --prefix frontend test -- --run` / Expected: 모두 PASS. 프런트 E2E는 Task 1에서 실행한 관련 파일 외 변경이 없으므로 전체를 다시 돌리지 않는다(memory: 작은 변경은 관련 spec).
- [ ] **Step 5: 커밋** — `git commit -m "test(game): add random tournament invariant check and document the backend"`
