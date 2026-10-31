# API 예시 계약

서버(`backend/server`)와 앞으로 만들 TS 온라인 클라이언트가 함께 기준으로 삼는 HTTP 예시다. 손으로 쓰지 않는다. `ApiContractTest`가 대본대로 실제 서버 스택을 호출해 얻은 요청·응답을 저장한 것이다.

## 형식

파일 하나가 요청·응답 교환 하나다.

```json
{ "method": "POST", "path": "/api/rooms/{roomId}/commands", "status": 200, "request": {}, "response": {} }
```

- `path`의 `{roomId}`·`{requestId}`는 자리표시자다. `history.json`의 경로에는 쿼리까지 그대로 들어 있다.
- `request`는 본문이고, 본문이 없으면 `null`이다.
- ID와 시각은 고정값으로 실행했고, 방 코드는 `ABC234`, CSRF 토큰은 `csrf-token-example`로 가렸다.

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

## 응답 모양이 갈리는 곳

- 생성·참가 성공은 `{roomId, code, participantId, controlGeneration, state}`다.
- 장부에 기록된 명령 결과는 `{requestId, sequence, outcome, code, resultStateVersion, latestState}`다.
- 명령의 `CONTROL_LOST`처럼 명령 장부에 기록되지 않은 거절은 `outcome` 없이 `{code, message}`다. `SEQUENCE_GAP`·`PROTOCOL_INCOMPATIBLE`·`INVALID_INPUT`·`ROOM_NOT_FOUND`도 그렇다. 인수 거절도 같은 모양이다.
- 본문이 `{code}`뿐인 것은 `ORIGIN_REJECTED`·`CSRF_REJECTED`·`NO_SESSION`(필터 응답)과 `TOO_MANY_STREAMS`다. 본문 과대 413은 `{code, message}`다.

## 검사와 갱신

`ApiContractTest`는 예시 파일 목록과 실제 교환 목록이 같은지, 필드 이름·타입·값이 같은지 검사한다. 서버에 응답 DTO가 없어 DTO 왕복 대신 이 비교를 쓴다. TS 쪽 검사는 계획 3에서 추가한다.

응답을 의도적으로 바꿨을 때만 저장소 루트에서 다시 만든다. 값이 정확히 `1`일 때만 동작하고 `CI` 환경 변수가 있으면 거절한다. 다시 만든 실행은 일부러 실패하므로, diff를 검토한 뒤 변수 없이 다시 실행해 통과를 확인한다.

```bash
UPDATE_API_CONTRACT=1 backend/gradlew -p backend :server:cleanTest :server:test --tests '*ApiContractTest*'
```
