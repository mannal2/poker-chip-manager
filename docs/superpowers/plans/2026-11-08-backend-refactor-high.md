# 백엔드 리팩터링 (우선순위 높음 3항목)

작성일: 2026-11-08
상태: 계획. 구현 전.
범위: `backend/server`만 수정한다. `backend/game`과 `backend/game-json`은 프런트엔드 규칙 모듈과 1:1 대응을 유지하기 위해 손대지 않는다.

## 목표와 원칙

1. **동작을 바꾸지 않는다.** HTTP 상태, 오류 코드, 응답 본문, 원장 기록 순서가 모두 지금과 같아야 한다. `ApiContractTest`와 온라인 e2e가 이를 확인한다.
2. 중복된 코드를 한 곳으로 모아, 같은 규칙을 한 번만 고치면 되게 한다.
3. 문자열 오류 코드를 컴파일러가 검사하는 타입으로 바꾼다.
4. 의존 방향(`api`·`auth`·`realtime`·`ops` → `room`·`registry`)은 그대로 둔다. 새 코드도 `room` 패키지에 두면 Spring 없이 쓸 수 있고, `ArchitectureTest`를 통과한다.

## 작업 1: 요청 원장 처리 한 곳으로 모으기

### 현재

세 컨트롤러가 아래 흐름을 각자 복사해 쓴다.

```
synchronized (ledger) {
  replay = ledger.replayOf(requestId, sequence, fingerprint)   // 충돌·만료·순번 건너뜀은 예외
  if (replay 있음) {
    거절이었으면 같은 코드로 RoomException
    아니면 저장된 결과로 응답
  }
  try { outcome = 작업 실행 }
  catch (RoomException e) { REJECTED 기록 후 다시 던짐 }
  outcome 기록   // 응답을 만들다 실패해도 결과는 남도록 응답보다 먼저
  return 응답(outcome)
}
```

- [RoomController.java:87-120](../../../backend/server/src/main/java/xyz/jwlee/poker/server/api/RoomController.java:87) `bind` (방 생성·입장)
- [RecoveryController.java:61-80](../../../backend/server/src/main/java/xyz/jwlee/poker/server/api/RecoveryController.java:61) `ask` (복구 신청)
- [CommandController.java:99-130](../../../backend/server/src/main/java/xyz/jwlee/poker/server/api/CommandController.java:99) `control` (조작권 인수)

`CommandPipeline.execute`는 거절도 결과로 기록하고 예외를 던지지 않으므로 흐름이 다르다. 이번 작업 대상에서 제외한다.

### 변경

`RequestLedger`에 메서드 하나를 추가한다.

```java
// 같은 요청은 처음 결과로 답하고, 새 요청은 한 번만 실행해 결과를 기록한 뒤 응답을 만든다
public <T> T runOnce(String requestId, long sequence, String fingerprint,
                     Supplier<RequestOutcome> work, Function<RequestOutcome, T> respond) {
    synchronized (this) {
        Optional<RequestOutcome> replay = replayOf(requestId, sequence, fingerprint);
        if (replay.isPresent()) {
            RequestOutcome first = replay.get();
            if (first.outcome() == RequestOutcome.Outcome.REJECTED) throw RoomException.replayed(first.code());
            return respond.apply(first);
        }
        RequestOutcome outcome;
        try {
            outcome = work.get();
        } catch (RoomException e) {
            record(RequestOutcome.rejected(requestId, sequence, e.code()), fingerprint);
            throw e;
        }
        // 작업은 끝났으므로 응답을 만들다 실패해도 결과가 남도록 먼저 기록한다
        record(outcome, fingerprint);
        return respond.apply(outcome);
    }
}
```

- `RequestOutcome.rejected(requestId, sequence, code)` 정적 팩터리를 추가해 `new RequestOutcome(…, REJECTED, code, 0, null)` 반복을 없앤다.
- `RoomController.bind`의 작업은 지금 `RoomRegistry.Entry`를 돌려준다. 람다 안에서 `Entry`를 `RequestOutcome`(APPLIED, `entry.stateVersion()`, `entry.roomId()`)으로 바꿔 돌려주고, 응답 함수는 `outcome.roomId()`로 지금처럼 응답한다.
- 세 컨트롤러는 `ledger.runOnce(...)` 한 번 호출로 바뀐다. 잠금 객체는 지금과 같은 원장 인스턴스이므로 잠금 순서와 범위는 바뀌지 않는다.
- `RoomController` 클래스 주석과 `CommandController.control` 주석의 `synchronized (ledger) { check; do the work; record }` 설명은 `RequestLedger.runOnce`를 가리키도록 고친다.

### 테스트

- `RequestLedgerTest`에 `runOnce` 사례를 추가한다(먼저 실패하는 테스트를 쓴다).
  - 새 요청 성공: 작업 1회 실행, APPLIED 기록, 응답 반환
  - 새 요청 거절: REJECTED 기록 후 같은 예외 전파
  - 재시도(성공 기록): 작업을 실행하지 않고 저장된 결과로 응답
  - 재시도(거절 기록): 작업을 실행하지 않고 같은 코드로 예외
  - 같은 순번에 다른 내용: `REQUEST_CONFLICT`, 아무것도 기록하지 않음
  - 응답 함수가 실패해도 결과는 기록되어 있음
- 회귀: `RoomControllerTest`, `RecoveryApiTest`, `ControlTakeoverTest`, `RoomHttpTest`, `ApiContractTest`

## 작업 2: JSON 입력 해석 도우미 합치기

이번 계획은 **1단계(중복 제거)만** 다룬다. 명령 입력을 레코드로 해석하는 2단계는 별도 계획으로 미룬다.

### 현재

같은 검사가 파일마다 따로 있다.

| 함수 | 위치 |
|---|---|
| payload가 객체인지 (`object`) | GameCommands.java:258, WaitingRoomCommands.java:175 |
| 빈 payload인지 (`emptyPayload`, 인라인 검사) | GameCommands.java:251, WaitingRoomCommands.leave·takeHost, ResultCommands.java:24-27 |
| 문자열 필드 (`string`, `Fields.string`) | WaitingRoomCommands.java:183, RoomController.Fields |
| 필수 필드 (`requiredField`) | GameCommands.java:266 |
| 정수 필드 (`integer`) | GameCommands.java:275, WaitingRoomCommands.java:192 |
| 문자열 배열 (`strings`) | WaitingRoomCommands.java:200 |
| 승자 맵 (`winners`) | GameCommands.java:285 |
| 입력 오류 예외 (`invalid`) | GameCommands, WaitingRoomCommands, CommandController, RoomController.Fields |
| 복구 신청 id 읽기 | RecoveryCommands.java:50-53 (인라인) |
| 봉투(protocolVersion·id·순번) 검사 | CommandController.parse·requireObjectOfThisProtocol·text·number, RoomController.Fields.parse·id |

### 변경

1. `room` 패키지에 `Payload` 유틸리티 클래스를 만든다(Spring 의존 없음, `final`, 생성자 숨김).

   ```java
   // 명령 payload의 형식을 검사해 값을 꺼내며, 형식이 틀리면 INVALID_INPUT으로 거절한다
   final class Payload {
       static JsonNode object(JsonNode payload)
       static void requireEmpty(JsonNode payload)          // null, JSON null, 빈 객체만 허용
       static JsonNode required(JsonNode body, String field)
       static String string(JsonNode body, String field)
       static int integer(JsonNode body, String field)
       static List<String> strings(JsonNode body, String field)
       static Map<String, List<String>> winners(JsonNode node)
       static RoomException invalid()
   }
   ```

   각 함수의 검사 조건은 지금 코드와 글자 그대로 같게 옮긴다. 예를 들어 `integer`는 `isIntegralNumber() && canConvertToInt()`를 유지한다.

2. `GameCommands`, `WaitingRoomCommands`, `ResultCommands`, `RecoveryCommands`의 private 도우미와 인라인 검사를 `Payload` 호출로 바꾸고, private 도우미는 지운다.
3. `api` 패키지에 `Envelope` 클래스를 만들어 요청 봉투 검사를 모은다.

   ```java
   // 요청 본문의 공통 필드(protocolVersion, 스트림·요청 id, 순번)를 검사해 읽는다
   final class Envelope {
       static int requireProtocol(JsonNode node)                    // 객체 확인 + 버전 일치, 아니면 PROTOCOL_INCOMPATIBLE
       static String text(JsonNode node, String field, int max, boolean required)
       static long number(JsonNode node, String field, long min)
   }
   ```

   `CommandController`의 `requireObjectOfThisProtocol`·`text`·`number`·`invalid`와 `RoomController.Fields`의 `parse`·`id`가 이것을 쓰게 한다. `RoomController.Fields`는 클래스로 남기되 내부 검사만 `Envelope`에 맡긴다. `id`는 `text(node, field, MAX_ID_LENGTH, true)`와 조건이 같은지 확인한 뒤 합친다. 조건이 다르면 합치지 않고 그 이유를 주석으로 남긴다.
4. `RoomSocketHandler.textOrNull`과 `parse`는 웹소켓 메시지용이고, 거절 대신 무시하는 동작이 다르므로 그대로 둔다.
5. 잘못 붙은 주석을 고친다. GameCommands.java:250에 "문자열 배열 필드를 꺼내고…"라는 주석이 `emptyPayload` 위에 붙어 있다.

### 테스트

- `PayloadTest`를 새로 만든다. 함수마다 정상 값, 필드 없음, 타입 틀림, 범위 초과(정수)를 확인한다.
- 회귀: `GameCommandsTest`, `WaitingRoomCommandsTest`, `ResultCommandsTest`, `RecoveryCommandsTest`, `CommandControllerTest`, `RoomControllerTest`, `ApiContractTest`

## 작업 3: 오류 코드를 enum으로 모으기

### 현재

- `new RoomException("…")`가 약 37종의 코드로 75번 쓰인다.
- 같은 코드가 여러 곳에 따로 적혀 있다.
  - [ApiError.java](../../../backend/server/src/main/java/xyz/jwlee/poker/server/api/ApiError.java): 한국어 메시지
  - [ApiExceptionHandler.java](../../../backend/server/src/main/java/xyz/jwlee/poker/server/api/ApiExceptionHandler.java): 예외로 던져진 코드의 HTTP 상태 표(`STATUS`)와, 원장에 거절로 기록된 코드의 상태(`rejectionStatus`)
  - 필터와 보안 설정의 직접 문자열: `BODY_TOO_LARGE`, `RATE_LIMITED`, `ORIGIN_REJECTED`, `CSRF_REJECTED`, `NO_SESSION`, `TOO_MANY_STREAMS`, `HTTP_ERROR`, `INTERNAL_ERROR`
  - `StartConditions.blockReason`의 `Optional<String>`
- 게임 규칙 거절은 `RuleErrorCode` 등 규칙 모듈의 enum 이름이 문자열로 그대로 전달된다(`GameCommands.applied`).

### 변경

1. `room` 패키지에 `ErrorCode` enum을 만든다. 서버가 직접 만드는 모든 응답 오류 코드를 담는다.

   ```java
   // 서버가 응답에 싣는 오류 코드와, 예외로 던져졌을 때의 HTTP 상태
   public enum ErrorCode {
       INVALID_INPUT(400), NO_SESSION(401), FORBIDDEN(403), ROOM_NOT_FOUND(404), …,
       NOT_YOUR_TURN(null), INVALID_ACTION(null), …;   // null: 지금 STATUS 표에 없음 → 500 (현재 동작 유지)
       private final Integer thrownStatus;
   }
   ```

   - `thrownStatus`는 지금의 `STATUS` 표 값을 그대로 옮긴다. 표에 없던 코드는 `null`로 두고, 지금처럼 500으로 응답한다.
   - `rejectionStatus`의 switch는 `ErrorCode.recordedStatus(String code)` 정적 메서드로 옮긴다. 값은 그대로 둔다.
   - `UNKNOWN_TYPE` → 응답 코드 `INVALID_INPUT` 치환도 enum의 `wire()` 메서드로 옮긴다.
2. `RoomException`의 생성자를 정리한다.
   - `new RoomException(ErrorCode)`: 서버 코드
   - `RoomException.rule(Enum<?> code)`: 규칙 모듈 거절. `RuleErrorCode`, `SettlementErrorCode`, `SettingsErrorCode`의 이름을 그대로 쓴다.
   - `RoomException.replayed(String code)`: 원장에 기록된 코드를 다시 던질 때만 쓴다.
   - `code()`는 지금처럼 `String`을 돌려준다. 원장과 응답 본문 형식이 그대로 유지된다.
   - `String` 생성자는 지운다. 그러면 남은 문자열 사용처를 컴파일러가 모두 찾아 준다.
3. 75곳의 `new RoomException("X")`를 `new RoomException(ErrorCode.X)`로 바꾼다. `StartConditions.blockReason`은 `Optional<ErrorCode>`를 돌려주게 바꾼다.
4. 필터·보안 설정·`ApiExceptionHandler`의 직접 문자열을 `ErrorCode.X.name()`으로 바꾼다. `JsonErrors.write`와 `ApiError.of`가 `ErrorCode`를 받는 오버로드를 추가한다.
5. `ApiError`의 메시지 표는 enum의 `message` 필드로 옮긴다. 메시지가 없는 코드(규칙 코드 등)는 지금 `ApiError.of`의 기본 동작을 따른다. 메시지를 지울지는 이번 범위에서 정하지 않는다(리뷰 항목 7).
6. 웹소켓 종료 메시지 이름(`ACCESS_REVOKED`, `ROOM_GONE`, `PROTOCOL_INCOMPATIBLE`)은 오류 응답 코드가 아니라 메시지 종류이므로 이번에 바꾸지 않는다. 다만 `PROTOCOL_INCOMPATIBLE`은 오류 코드와 이름이 같으므로 `ErrorCode.PROTOCOL_INCOMPATIBLE.name()`을 써도 된다.

### 프런트엔드와의 대응 확인 (선택, 권장)

서버 코드와 프런트엔드 `errorMessages.ts`가 어긋나지 않는지 자동으로 검사한다.

- `shared/api-contract/error-codes.json`에 서버가 보낼 수 있는 오류 코드 목록을 둔다. `ErrorCode` 전체와 규칙 모듈 enum 세 개의 이름이 들어간다.
- 백엔드 `ErrorCodeContractTest`: 실제 enum들의 이름 집합과 파일 목록이 같은지 확인한다.
- 프런트엔드 `tests/gameplay/errorMessages.test.ts`: 파일의 모든 코드가 `messageFor`에서 기본 문구("처리할 수 없습니다. (코드)")가 아닌 전용 문구를 갖는지 확인한다. 화면에 오지 않는 코드(`HTTP_ERROR`, `INTERNAL_ERROR`, `CSRF_REJECTED` 등)는 예외 목록으로 명시한다.
- 이 검사로 빠진 문구가 발견되면, 합니다체·"플레이어" 원칙에 맞춰 문구를 추가한다.

### 테스트

- `ErrorCodeTest`를 새로 만든다.
  - `thrownStatus`가 지금 `STATUS` 표와 같음: 옮기기 전 표를 테스트에 고정값으로 적어 비교한다.
  - `recordedStatus`가 지금 `rejectionStatus`와 같음: 모든 코드에 대해 비교한다.
  - `UNKNOWN_TYPE`의 응답 코드가 `INVALID_INPUT`임
- `ApiErrorTest`를 enum 기준으로 고친다.
- 회귀: 백엔드 전체(`./gradlew test`), 특히 `ApiContractTest`

## 진행 순서와 검증

| 순서 | 커밋 | 검증 |
|---|---|---|
| 1 | `refactor: run ledgered requests once` (작업 1) | `./gradlew :server:test` |
| 2 | `refactor: share payload parsing helpers` (작업 2) | `./gradlew :server:test` |
| 3 | `refactor: type server error codes` (작업 3, 대응 확인 제외) | `./gradlew test` |
| 4 | `test: check error codes against the frontend` (선택) | `./gradlew test`, `npx vitest run` |
| 마지막 | - | 온라인 e2e 전체 `npm run test:e2e:online`, 재시작 e2e `npm run test:e2e:restart` |

- 작업 1과 2는 서로 다른 파일을 주로 고치지만 `CommandController`·`RoomController`가 겹친다. 순서대로 진행한다.
- 작업 3은 작업 1·2가 만든 `RequestOutcome.rejected`, `Payload.invalid`, `Envelope`도 함께 enum으로 바꾸므로 마지막에 한다.
- 각 커밋 전에 `./gradlew :server:test`가 통과해야 한다. 실패하면 숨기지 않고 출력과 함께 보고한다.
- 커밋에는 AI 작성 표시를 넣지 않는다. 푸시와 PR은 별도 요청이 있을 때만 한다.

## 문서

- [ARCHITECTURE.md](../../../ARCHITECTURE.md)의 백엔드 서버 앱 절에 다음 내용을 추가한다.
  - `RequestLedger.runOnce`: 재시도 처리의 단일 입구
  - `Payload`·`Envelope`: 입력 형식 검사 위치
  - `ErrorCode`: 오류 코드와 HTTP 상태의 단일 정의
- 변경 지점 표의 "서버 명령 추가·검사 순서 변경" 행에서 "HTTP 상태는 `ApiExceptionHandler`"를 "`ErrorCode`"로 고친다.

## 이번 범위에서 제외

- 명령 입력을 레코드로 해석하는 작업(리뷰 2번의 2단계)
- `Room` 책임 분리, 가변 컬렉션 노출, `room` 패키지 나누기(리뷰 4~6번)
- `ApiError` 메시지 삭제 여부(리뷰 7번)
- 지금 상태 표에서 보이는 불일치는 이번에 고치지 않고 기록만 한다. 예를 들어 `INVALID_INPUT`은 예외로 던지면 400이지만 원장에 거절로 기록되면 422이고, `NOT_YOUR_TURN`은 표에 없어서 예외로 던지면 500이다. 고칠지는 별도로 정한다.
