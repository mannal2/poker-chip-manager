# API 예시 계약

서버(`backend/server`)와 TS 온라인 클라이언트가 함께 기준으로 삼는 HTTP·WebSocket 예시다. 손으로 쓰지 않는다. `ApiContractTest`가 대본대로 실제 서버 스택을 호출해 얻은 요청·응답·소켓 메시지를 저장한 것이다.

## 형식

`ws-`로 시작하지 않는 파일 하나가 요청·응답 교환 하나다.

```json
{ "method": "POST", "path": "/api/rooms/{roomId}/commands", "status": 200, "request": {}, "response": {} }
```

- `path`의 `{roomId}`·`{requestId}`는 자리표시자다. `history.json`의 경로에는 쿼리까지 그대로 들어 있다.
- `request`는 본문이고, 본문이 없으면 `null`이다.
- `ws-`로 시작하는 파일은 교환이 아니라 소켓 메시지 하나의 JSON이다.
- ID와 시각은 고정값으로 실행했고, 방 코드는 `ABC234`, CSRF 토큰은 `csrf-token-example`로 가렸다.
- 소켓 예시는 실제 핸드셰이크 검사·`RoomSocketHandler`·`Connection`을 지나지만 전송 계층만 테스트의 `ContractScreen`으로 바꿨다. MockMvc 세션으로는 실제 소켓을 열 수 없기 때문이다. 고정 시계에서는 PING 주기가 오지 않아 `ws-ping`의 `nonce`는 대본이 정한 값이다.

## 파일

| 파일 | 내용 |
|---|---|
| `session`, `stream` | 세션 발급, 화면 스트림 등록 |
| `create-room`, `join-room` | 방 생성(201), 참가 |
| `snapshot-waiting`, `snapshot-playing`, `snapshot-settlement`, `snapshot-result` | 단계별 `GET state` 스냅샷 |
| `command-applied`, `command-rejected` | 명령 APPLIED, 명령 REJECTED(`STALE_STATE`, 409) |
| `command-control-lost` | 옛 세대 명령의 409 `CONTROL_LOST` |
| `command-sequence-gap` | 순번을 건너뛴 명령의 409 `SEQUENCE_GAP` |
| `request-result` | `GET requests/{requestId}` |
| `history` | 기록 한 페이지 |
| `control-applied`, `control-lost` | 조작 화면 인수 성공, 409 `CONTROL_LOST` |
| `error-not-found` | 오류 본문 `{code, message}`(404 `ROOM_NOT_FOUND`) |
| `error-origin-rejected` | 필터 오류 본문 `{code}`(403 `ORIGIN_REJECTED`) |
| `recovery-request`, `recovery-approved` | 복구 신청(201), 승인된 신청의 결과 조회 |
| `ws-subscribe` | 클라이언트가 보내는 SUBSCRIBE |
| `ws-snapshot` | 방 변경을 알리는 SNAPSHOT. 방장이 받는 것이라 `recoveryRequests`가 채워져 있다 |
| `ws-ping` | 서버의 생존 확인 |
| `ws-access-revoked`, `ws-room-gone` | 연결을 닫기 전의 마지막 메시지 |

## 응답 모양이 갈리는 곳

- 생성·참가 성공은 `{roomId, code, participantId, controlGeneration, state}`다.
- 장부에 기록된 명령 결과는 `{requestId, sequence, outcome, code, resultStateVersion, latestState}`다.
- 명령의 `CONTROL_LOST`처럼 명령 장부에 기록되지 않은 거절은 `outcome` 없이 `{code, message}`다. `SEQUENCE_GAP`·`PROTOCOL_INCOMPATIBLE`·`INVALID_INPUT`·`ROOM_NOT_FOUND`도 그렇다. 인수 거절도 같은 모양이다.
- 구독·RESYNC·조작 인수로 받는 SNAPSHOT은 `previousVersion: null`, `events: []`다. `ws-snapshot`처럼 방 변경으로 받는 것은 이전 버전과 이벤트가 있다.
- 화면은 `(stateVersion, draftVersion)`이 낮은 SNAPSHOT을 버린다. 같은 쌍은 `previousVersion`이 `null`일 때만 효과 재생 없이 적용한다.
- 마지막 메시지(`ACCESS_REVOKED`·`ROOM_GONE`·`PROTOCOL_INCOMPATIBLE`) 뒤에는 1000, 메시지 없이 끊을 때는 1001로 닫는다. 재연결 여부는 코드가 아니라 마지막 메시지를 받았는지로 정한다.
- 복구 결과 조회는 대기·거절·만료·대체면 `{recoveryRequestId, status}`만, 승인이면 생성·참가와 같은 필드를 함께 돌려준다.
- 본문이 `{code}`뿐인 것은 `ORIGIN_REJECTED`·`CSRF_REJECTED`·`NO_SESSION`(필터 응답)과 `TOO_MANY_STREAMS`다. 본문 과대 413은 `{code, message}`다.

## 검사와 갱신

`ApiContractTest`는 예시 파일 목록과 실제 교환 목록이 같은지, 필드 이름·타입·값이 같은지 검사한다. 서버에 응답 DTO가 없어 DTO 왕복 대신 이 비교를 쓴다. `frontend/tests/online-game/contract.test.ts`가 TS 수신 타입과 예시를 검사한다. `client.test.ts`·`roomSocket.test.ts`·`onlineController.test.ts`는 통신·버전 병합·동일 요청 복구를 검사하고 실제 서버 연결은 `npm --prefix frontend run test:e2e:online`으로 별도 실행한다.

응답을 의도적으로 바꿨을 때만 저장소 루트에서 다시 만든다. 값이 정확히 `1`일 때만 동작하고 `CI` 환경 변수가 있으면 거절한다. 다시 만든 실행은 일부러 실패하므로, diff를 검토한 뒤 변수 없이 다시 실행해 통과를 확인한다.

```bash
UPDATE_API_CONTRACT=1 backend/gradlew -p backend :server:cleanTest :server:test --tests '*ApiContractTest*'
```

인증 쿠키·CSRF·요청 원장은 브라우저 저장소에 복제하지 않는다. 마지막 방 메타데이터와 탭 자동 인수 표시만 저장하며, 결과 불명 요청은 같은 화면 메모리에 보관한다. BFCache 복귀는 같은 스트림·요청으로 이어가고 실제 문서 종료는 keepalive로 화면 스트림을 삭제한다.
