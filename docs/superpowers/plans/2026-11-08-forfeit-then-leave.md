# 기권 후 방 나가기 흐름 설계와 구현 계획

작성일: 2026-11-08
상태: 설계·계획 완료. 구현 전.
선행 작업: [2026-11-08-dialog-actions.md](2026-11-08-dialog-actions.md) (확인창 하단 버튼 줄, 구현 완료)

## 목표

온라인 진행 중(PLAYING) 기권을 "기권 → 방에 남을지·나갈지"로 이어지는 흐름으로 만든다.

1. 본인 기권: `기권` → 기권 확인 → "방에 남아 관전" 또는 "방에서 나가기"를 고른다.
2. 방장의 기권 처리: `기권 처리` → 대상 카드 선택 → 기권 확인 → "방에 남기기" 또는 "방에서 내보내기"를 고른다.
3. 방장의 기권 처리 대상을 연결이 끊긴 사람에서 **방장을 제외한 모든 미탈락 참가자**로 넓힌다.
4. 이미 탈락했거나 기권한 사람은 진행 중에도 `방 나가기`로 나갈 수 있고, 방장은 이런 사람을 `참가자 내보내기`로 내보낼 수 있다.
5. 방을 나간 사람은 입장 화면으로 돌아가 다른 방에 새로 참가할 수 있다.

## 결정 사항 (사용자 확인 2026-11-08)

- 기권과 방 나가기는 별도 기능이 아니라 이어지는 흐름이다.
- 서버 명령은 **두 번째 질문에 답한 뒤에** 보낸다. 두 번째 창에서 `닫기`를 누르면 아무 명령도 보내지 않는다.
- 방장의 기권 처리는 연결 여부와 관계없이 할 수 있다(기존 2번 요청을 이 작업에 합침).
- 탈락자(칩 소진·기권 후 남은 사람)는 기권 단계 없이 `방 나가기`/`참가자 내보내기`만 거친다.

## 현재 동작 (조사 결과)

| 항목 | 현재 | 근거 |
|---|---|---|
| 본인 기권 | 진행 중 미탈락 참가자. 방장은 `TRANSFER_HOST_FIRST`로 거절 | `GameCommands.forfeit` (GameCommands.java:128) |
| 방장 기권 처리 | 끊긴 참가자만. 접속 중이면 `TARGET_CONNECTED` | `GameCommands.forfeitDisconnected` (GameCommands.java:143-157) |
| 방 나가기 | 진행 중이면 `NOT_WAITING` | `WaitingRoomCommands.leave` (WaitingRoomCommands.java:95-104) |
| 참가자 내보내기 | 대기방만(`requireWaiting`) | `WaitingRoomCommands.kick` (WaitingRoomCommands.java:84-91) |
| 메뉴 | 진행 중에는 `방 나가기`·`참가자 내보내기` 없음. `기권 처리` 대상은 끊긴 미탈락 참가자 | `OnlineMenu.menuItems` (OnlineMenu.tsx:17-71) |
| 확인 흐름 | 확인창 한 번 후 명령 하나를 보냄 | `RoomPage.choose` (RoomPage.tsx:125-170) |

진행 중에 참가자가 명단에서 빠질 때 이미 처리되는 것:

- `Room.removeParticipant`는 참가자 명단·원장·연결·복구 신청을 정리하고, 방장이면 다음 방장을 고르며, 마지막 사람이면 방을 닫는다(Room.java:404-418).
- `room.playerIds()`에는 그 사람의 게임 플레이어 id가 남는다. 게임 상태의 플레이어(이름·칩·탈락 표시)도 그대로 남아 테이블에 계속 표시된다.
- `hasPlayerLeft()`가 참이 되어 그 토너먼트의 무르기가 잠긴다(`UNDO_LOCKED`, MULTIPLAYER_MODE 9절의 기존 규칙). 기권은 원래 무르기 스냅샷을 지우므로 동작 차이는 없다.
- `AutoPlay`는 끊긴 행동자만 자동 처리한다. 나간 사람은 기권·탈락 상태라 행동자가 될 수 없다.
- 다시 준비하기 명단은 참가자 명단 기준이라 나간 사람은 빠진다(결과 화면 나가기와 같은 기존 규칙).
- 클라이언트는 자기 `LEAVE`가 적용되면 `completeLeave()`로 방 화면을 떠난다(onlineController.ts:628). 내보내진 사람은 `ACCESS_REVOKED`를 받아 `revoked` 화면으로 간다(onlineController.ts:759-766).
- `OnlineController.send(commands[])`는 명령을 순서대로 보내고 하나라도 실패하면 멈춘다(onlineController.ts:438-470).

따라서 서버 게임 규칙(`backend/game`)은 수정하지 않는다. 방 명령의 허용 조건만 바꾼다.

## 설계

### 서버 허용 조건

| 명령 | 변경 후 조건 (진행 중) | 거절 코드 |
|---|---|---|
| `FORFEIT_DISCONNECTED` | 대상이 존재하고, 방장이 아니며, 게임 참가자. **연결 여부 검사 삭제** | 기존 `INVALID_ACTION` 등 |
| `LEAVE` | 요청자가 탈락했거나 기권한 사람(`!canHoldRoom`). 방장이면 거절 | 미탈락: `NOT_ELIMINATED`(신규) / 방장: `TRANSFER_HOST_FIRST` |
| `KICK` | 대상이 탈락했거나 기권한 사람이고, 요청자 본인이 아님. 방장만(기존 hostOnly) | 미탈락: `NOT_ELIMINATED` |

- 대기방·결과 화면의 `LEAVE`·`KICK` 동작은 그대로 둔다.
- 명령 이름 `FORFEIT_DISCONNECTED`는 바꾸지 않는다. 이름을 바꾸면 API 계약 예시와 클라이언트 타입이 함께 바뀌므로 이번 범위에서 제외하고, MULTIPLAYER_MODE.md에 "이름은 과거 이름이며 연결 여부와 무관"이라고 적는다.
- `TARGET_CONNECTED` 오류 코드는 더 이상 발생하지 않는다. 서버 `ApiError`·`ApiExceptionHandler`와 클라이언트 `errorMessages.ts`에서 함께 지운다. 이전 버전 클라이언트는 이 코드를 받을 일이 없어지므로 호환 문제는 없다.
- 기권과 나가기를 묶은 새 복합 명령은 만들지 않는다. 클라이언트가 `[FORFEIT, LEAVE]` 또는 `[FORFEIT_DISCONNECTED, KICK]`를 순서대로 보낸다.
  - 첫 명령만 성공하고 두 번째가 실패하면 그 사람은 탈락 상태로 방에 남는다. 이 상태는 정상 상태이며, 메뉴의 `방 나가기`/`참가자 내보내기`로 다시 시도할 수 있다. 화면에는 "기권은 처리되었지만 방에서 나가지 못했습니다. 메뉴에서 다시 시도하세요."를 알린다.
- `TRANSFER_HOST_FIRST`의 문구를 "방장은 방장을 넘긴 뒤에 기권하거나 나갈 수 있습니다."로 바꾼다. 서버 `ApiError`와 클라이언트 `errorMessages.ts`를 같이 고친다.
- `NOT_ELIMINATED` 문구: "진행 중에는 탈락한 참가자만 방을 나갈 수 있습니다." 두 곳에 추가한다. `ApiExceptionHandler`의 상태 코드는 다른 규칙 거절과 같은 422로 한다.

### 관리 메뉴 (진행 중)

`menuItems`(OnlineMenu.tsx)에서 진행 중 항목을 다음과 같이 만든다. 대기방·결과 화면 항목은 바꾸지 않는다.

| 항목 | 보이는 사람 | 대상 | 흐름 |
|---|---|---|---|
| `홈` | 모두 | - | 기존과 같음 |
| `기권` | 미탈락 참가자(방장 포함, 방장은 기존처럼 "먼저 방장을 넘겨주세요") | 본인 | 기권 확인 → 남기/나가기 선택 |
| `방 나가기` | 탈락·기권한 참가자 중 방장이 아닌 사람 | 본인 | 나가기 확인 한 번 |
| `기권 처리` | 방장 | 방장이 아닌 미탈락 참가자(연결 여부 무관) | 카드 선택 → 기권 확인 → 남기기/내보내기 선택 |
| `참가자 내보내기` | 방장 | 방장이 아닌 탈락·기권 참가자 | 카드 선택 → 내보내기 확인 한 번 |
| `방장 넘기기` | 방장 | 기존과 같음 | 기존과 같음 |
| `토너먼트 중단` | 방장 | - | 기존과 같음 |

- 진행 중 `참가자 내보내기`는 대상(방장이 아닌 탈락·기권 참가자)이 한 명 이상 있을 때만 메뉴에 표시한다. 기존 `기권 처리`가 대상이 있을 때만 보이는 것과 같은 규칙이다.
- 진행 중 `기권 처리`와 `참가자 내보내기`가 함께 있으면 두 버튼을 한 줄에 나란히 놓는다(사용자 결정 2026-11-08). 둘 다 방장이 다른 참가자를 정리하는 작업이라 연결된 기능으로 보이게 하기 위해서다. 하나만 있으면 지금처럼 한 줄 전체를 차지한다.
  - `MenuItem`에 `row?: string`을 추가하고 두 항목에 같은 값(`'participant-actions'`)을 준다. `menuItems`에서는 두 항목을 연속으로 넣는다(`기권` 다음, `방장 넘기기` 앞).
  - `OnlineMenu`는 같은 `row` 값을 가진 연속 항목을 `<div className="menu-row">`로 묶어 렌더한다. `base.css`에 `.menu-row { display: grid; grid-template-columns: 1fr 1fr; gap: calc(8 * var(--u)); }`를 추가한다.
  - 순서는 `[기권 처리] [참가자 내보내기]`로 한다. 미탈락자 정리가 더 자주 쓰이기 때문이다.
  - 반 너비(약 147u)에 `참가자 내보내기` 글자가 한 줄로 들어가는지 390×844, 360×740에서 확인한다. 줄바꿈되면 진행 중 항목의 표시 이름만 `내보내기`로 줄인다. 이때 `choose()`에서 `valid.label === '참가자 내보내기'`로 확인 문구를 고르는 분기(RoomPage.tsx:152)를 라벨 대신 명령 종류(`KICK`)로 판별하도록 바꾼다.
  - 이 항목들은 대기방 메뉴에는 해당하지 않는다. 대기방의 `참가자 내보내기`는 지금처럼 한 줄 전체를 쓴다.
- 방장 본인이 탈락한 경우: 방장은 `방 나가기`가 보이지 않는다. 먼저 `방장 넘기기`를 해야 한다(진행 중 방장 이전 대상은 미탈락자로 제한하는 기존 규칙 유지).
- `기권 처리` 대상에서 `connectedIds` 조건을 지운다. `menuItems`의 `connectedIds` 인자가 다른 곳에서 쓰이지 않게 되면 인자를 지우고 호출처(`OnlineMenu`, `RoomPage.choose`)도 정리한다.

### 두 단계 확인창

`RoomPage`의 `confirmation` 상태에 단계를 추가한다.

```ts
type Confirmation = {
  item: MenuItem;
  target?: RoomParticipant;
  step: 'confirm' | 'stay-or-leave';
};
```

`MenuItem`에 `then?: 'stay-or-leave'`를 추가하고, `기권`·`기권 처리` 항목에만 설정한다.

1단계 (기존 확인창 재사용)

- 제목: 항목 이름(`기권` / `기권 처리`)
- 본문: 대상 이름(기권 처리일 때) + 기존 `forfeitWarning`. 접속 중인 대상이면 "접속 중인 참가자입니다." 한 줄을 앞에 붙인다.
- 하단: `[닫기] [확인(primary)]`
- `확인`을 누르면 명령을 보내지 않고 2단계로 바꾼다(`step: 'stay-or-leave'`). 이때 `choose()`의 최신 상태 검증(대상 유효성, 범위)을 한 번 거친다.

2단계

| | 본인 기권 | 방장의 기권 처리 |
|---|---|---|
| 제목 | `기권 후 방 선택` | `기권 후 방 선택` |
| 본문 | 기권한 뒤 이 방에 남아 게임을 관전할지, 방에서 나갈지 선택하세요. 방에서 나가면 이 게임에 다시 들어올 수 없습니다. | `{이름}`님을 기권 처리한 뒤 방에 남길지, 방에서 내보낼지 선택하세요. 내보내면 이 게임에 다시 들어올 수 없습니다. |
| 버튼 | `[닫기] [방에 남기] [방 나가기]` | `[닫기] [방에 남기기] [방에서 내보내기]` |
| 전송 | 남기: `[FORFEIT]` / 나가기: `[FORFEIT, LEAVE]` | 남기기: `[FORFEIT_DISCONNECTED{id}]` / 내보내기: `[FORFEIT_DISCONNECTED{id}, KICK{id}]` |

- 버튼 세 개는 `.dialog-actions` 한 줄에 둔다. 두 선택 버튼은 모두 일반 버튼으로 하고, 어느 쪽도 primary로 강조하지 않는다. 사용자가 둘 중 하나를 의식적으로 고르게 하기 위해서다. 화면 너비 350u에서 세 버튼 글자가 줄바꿈 없이 들어가는지 확인하고, 넘치면 `.dialog-actions.stacked`(세로 배치, 닫기는 맨 아래) 변형을 추가한다.
- 2단계 `닫기`: 아무 명령도 보내지 않고 확인창을 닫는다. 방장의 기권 처리 흐름에서는 기존 1단계 닫기와 같게 카드 선택 상태로 돌아간다.
- 전송 직전에 `choose()`와 같은 최신 상태 검증을 다시 한다. 그사이 대상이 탈락했거나 방장이 바뀌었으면 "대상 또는 상태가 변경되었습니다. 다시 확인하세요."를 알리고 아무것도 보내지 않는다.
- `RoomPage.send(command)`를 `send(commands: ServerCommand[])`로 일반화해 `controller.send(commands)`에 그대로 넘긴다. 기존 호출처는 배열 하나로 감싼다.
- 두 번째 명령만 실패한 경우는 `controller.send`가 `false`를 반환하고 스냅샷상 대상이 탈락 상태가 된 것으로 판별한다. 이때 위의 부분 실패 문구를 알린다.

### 나간 뒤의 화면

- 본인이 나가면: 기존 `completeLeave()` 경로로 입장 화면에 돌아간다. 입장 화면에서 다른 방 코드로 참가하거나 새 방을 만들 수 있다. 이 동작은 대기방에서 나갈 때와 같으므로 새 코드는 필요 없다. e2e로 "나간 뒤 다른 방에 참가"를 확인한다.
- 내보내진 사람: 기존 `ACCESS_REVOKED` → `revoked` 화면(입장 화면 링크 포함). 대기방 내보내기와 같은 경로다.
- 남은 사람의 테이블: 나간 사람의 좌석은 게임 상태에 남아 이름과 탈락 표시로 계속 보인다. 연결 끊김 표시는 참가자 명단 기준이라 나간 사람에게는 붙지 않는다. 별도 "나감" 배지는 이번 범위에서 제외한다.

## 구현 작업

AGENTS.md에 따라 작업마다 검증하고 로컬에 커밋한다. 커밋에는 AI 작성 표시를 넣지 않는다.

### 작업 1: 서버 허용 조건 (`feat: allow leaving after elimination`)

파일

- `backend/server/src/main/java/xyz/jwlee/poker/server/room/GameCommands.java`: `forfeitDisconnected`의 `isConnected` 검사 삭제, 주석 갱신
- `backend/server/src/main/java/xyz/jwlee/poker/server/room/WaitingRoomCommands.java`: `leave`·`kick`에 진행 중 분기 추가(`GameCommands.canHoldRoom`으로 미탈락 판별)
- `backend/server/src/main/java/xyz/jwlee/poker/server/api/ApiError.java`, `ApiExceptionHandler.java`: `NOT_ELIMINATED` 추가, `TARGET_CONNECTED` 삭제, `TRANSFER_HOST_FIRST` 문구 변경

테스트 (먼저 실패하는 테스트를 쓴다)

- `GameCommandsTest`: 489행의 `TARGET_CONNECTED` 거절 사례를 "접속 중 대상도 기권 처리됨"으로 바꾼다.
- `WaitingRoomCommandsTest` 또는 `CommandPipelineTest`:
  - 진행 중 미탈락자의 `LEAVE` → `NOT_ELIMINATED`
  - 진행 중 기권한 사람의 `LEAVE` → 명단에서 빠짐, 게임 플레이어는 남음, `hasPlayerLeft()` 참
  - 진행 중 탈락한 방장의 `LEAVE` → `TRANSFER_HOST_FIRST`
  - 진행 중 `KICK` 미탈락 대상 → `NOT_ELIMINATED`, 기권한 대상 → 명단에서 빠짐
  - `FORFEIT` 후 `LEAVE` 연속 적용 뒤 같은 핸드가 정상 진행되고, 핸드 종료 후 기권자 스택이 분배됨
- `ApiErrorTest`: 코드 목록 변경 반영

검증: `backend/`에서 `./gradlew test`

### 작업 2: 클라이언트 메뉴와 오류 문구 (`feat: offer leave to eliminated players`)

파일

- `frontend/src/features/online-game/components/OnlineMenu.tsx`: 위 메뉴 표대로 `menuItems` 수정, `then` 필드 추가
- `frontend/src/features/gameplay/model/errorMessages.ts`: `NOT_ELIMINATED` 추가, `TARGET_CONNECTED` 삭제, `TRANSFER_HOST_FIRST` 문구 변경
- `frontend/src/features/online-game/api/types.ts`: 오류 코드 목록이 있으면 같이 수정

테스트

- `frontend/tests/online-game/onlineMenu.test.tsx`: 진행 중 탈락자(방장 아님)는 `['홈', '방 나가기']`, 방장의 `기권 처리` 대상에 접속 중인 참가자 포함, 방장의 `참가자 내보내기` 대상은 탈락자만, 탈락자가 없으면 `참가자 내보내기`가 없음, 둘 다 있으면 같은 `.menu-row` 안에 `기권 처리`·`참가자 내보내기` 순서로 렌더됨
- `frontend/tests/online-game/roomManagement.test.tsx`: 기존 기권 처리 대상 단언 갱신

검증: `npm run typecheck`, `npm run lint`, `npx vitest run`

### 작업 3: 두 단계 확인창 (`feat: ask whether to stay after forfeiting`)

파일

- `frontend/src/features/online-game/RoomPage.tsx`: `Confirmation.step`, 2단계 렌더, `send(commands[])`, 부분 실패 안내
- `frontend/src/shared/styles/base.css`: 버튼 세 개가 넘칠 때만 `.dialog-actions.stacked` 추가

테스트

- `frontend/tests/online-game/roomManagement.test.tsx`:
  - 1단계 `확인` 후 명령이 나가지 않고 2단계가 열림
  - 2단계 `닫기` → 명령 0건
  - `방에 남기` → `[FORFEIT]` 1건, `방 나가기` → `[FORFEIT, LEAVE]` 순서
  - 방장 흐름: `방에서 내보내기` → `[FORFEIT_DISCONNECTED, KICK]`, payload의 `participantId` 일치
  - 2단계 도중 대상이 탈락 상태로 바뀌면 전송하지 않고 안내
- `frontend/e2e/online/participant-selection.spec.ts`, `host-tools.spec.ts`의 기존 기권 처리 흐름에 2단계 선택(`방에 남기기`)을 추가한다. `e2e/online/managementSupport.ts`에 2단계 선택 도우미를 추가한다.

### 작업 4: 실제 서버 e2e (`test: cover forfeit then leave online`)

`frontend/e2e/online/`에 새 spec을 추가한다(예: `forfeit-leave.spec.ts`). 실제 서버로 3인 방을 만들고 다음을 확인한다.

1. 참가자 C가 `기권` → `방 나가기`: C는 입장 화면으로 돌아가고, 다른 방 코드로 새 방에 참가할 수 있다. A·B 화면에서 C 좌석은 탈락으로 남고 게임이 이어진다.
2. 방장 A가 **접속 중인** B를 `기권 처리` → `방에 남기기`: B는 방에 남아 관전하며 메뉴에 `방 나가기`가 보인다. 이어서 B가 `방 나가기`로 나갈 수 있다.
3. 방장 A가 접속 중인 참가자를 `기권 처리` → `방에서 내보내기`: 대상은 `revoked` 화면으로 가고, 남은 사람의 게임은 이어진다.

검증: `npm run test:e2e:online`(전체). 공통 확인창과 관리 메뉴를 바꾸므로 마지막에 `npm run test:e2e`도 전체 실행한다.

### 작업 5: 문서 (`docs: describe forfeit then leave flow`)

- `MULTIPLAYER_MODE.md`
  - 2절 표의 "중간 이탈" 행
  - 7절 관리 메뉴 표(`방 나가기`, `기권 처리`, `기권`, `참가자 내보내기` 조건)와 132행의 "기권 대상은 연결이 끊긴 미탈락 참가자로 제한" 문장
  - 10절의 기권 처리 조건(연결 무관), 두 단계 확인창, 나가기·내보내기 규칙, `FORFEIT_DISCONNECTED` 이름 설명
  - 변경 이력에 2026-11-08 항목 추가
- `UX_SPEC.md`: 관리 확인창 관련 문장이 있으면 두 단계 흐름을 반영한다.
- `ARCHITECTURE.md`: 온라인 관리 작업 설명에 두 단계 확인이 `RoomPage`에 있다는 한 줄을 추가한다.
- `shared/api-contract/README.md`: 명령별 조건을 적은 곳이 있으면 `LEAVE`·`KICK`·`FORFEIT_DISCONNECTED` 조건을 갱신한다.

## 위험과 확인할 점

- **세 버튼 줄의 너비:** 좁은 화면에서 `방에서 내보내기`가 줄바꿈될 수 있다. 작업 3에서 390×844, 360×740 화면으로 확인한다.
- **부분 실패:** 두 번째 명령이 연결 끊김으로 결과 불명이 되면 기존 결과 불명 처리(같은 요청 재확인)가 동작한다. 확인이 끝나기 전에는 다음 조작이 잠기므로 중복 전송은 없다.
- **방장의 접속 중 참가자 기권 처리:** 되돌릴 수 없는 조작이므로 1단계 본문에 "접속 중인 참가자입니다."를 표시하고, 2단계까지 거치게 한다.
- **좌석 번호:** 스냅샷의 참가자 `seat`은 명단 순서라 진행 중 누가 나가면 다른 사람의 값이 당겨진다. 클라이언트는 게임 참가자가 아닌 사람의 화면 기준 좌석에만 이 값을 쓴다(toGameState.ts:38). 진행 중 관전자 화면 회전이 바뀌지 않는지 작업 4에서 확인한다.
