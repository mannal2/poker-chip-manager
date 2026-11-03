# 방 부하 도구

`load-rooms.mjs`는 실제 쿠키·CSRF 토큰·Origin·WebSocket으로 참가자를 만들어 여러 방에서 게임을 진행시킨다. 서버 메모리 한도(Ruling R4: `BACKEND_MEM_LIMIT=768m`, Java 힙 384m)가 실제 사용량에 맞는지 판단할 근거를 모으는 도구다. Node 24만 있으면 되고 추가 의존성은 없다.

## 실행

```bash
node deploy/load/load-rooms.mjs --url http://127.0.0.1:8080 --rooms 10 --players 9 --minutes 10
```

| 인자 | 기본값 | 뜻 |
|---|---|---|
| `--url` | 없음(필수) | 서버 주소. 보내는 `Origin`도 이 주소에서 만든다 |
| `--rooms` | 10 | 동시에 운영할 방 수 |
| `--players` | 9 | 방마다 참가자 수(2~10). 첫 참가자가 방장이다 |
| `--minutes` | 1 | 모든 방이 준비된 뒤 플레이할 시간 |

결과 JSON은 표준 출력에 한 번 나오고 진행 기록은 표준 오류로 나온다. 오류가 하나라도 있으면 종료 코드가 1이다. Ctrl+C를 누르면 정리한 뒤 그때까지의 JSON을 출력하고, 한 번 더 누르면 정리를 기다리지 않고 바로 출력한다.

## 동작

- 참가자마다 `GET /api/session`으로 세션과 CSRF 토큰을 받고 화면 스트림을 연 뒤 방을 만들거나 코드로 참가한다. 이어서 `/ws`에 구독하고 PING마다 PONG으로 답한다.
- 방장은 모두 연결되면 자신을 딜러로 정하고 게임을 시작한다. 참가자는 자기 차례에 체크할 수 있으면 체크하고 아니면 폴드하므로 핸드가 쇼다운 전에 끝난다. 게임이 끝나면 방장이 다시 준비하고 새로 시작한다.
- 한 참가자의 명령 사이에는 사람처럼 1~2초를 쉰다. 명령 빈도 제한(초당 5개)을 시험하지 않는다.
- 결과 불명 요청은 같은 요청 ID·순번·본문으로 다시 보낸다.
- 시간이 끝나면 방장이 진행 중인 게임을 중단하고 참가자가 한 명씩 방을 나간 뒤 소켓을 1000으로 닫고 화면 스트림을 지운다. 마지막 참가자가 나가면 방이 사라진다.

방 생성·새 세션·참가 단계에서 받은 429는 오류가 아니다. `Retry-After`만큼 기다렸다가 같은 요청을 다시 보내고 `setupWaits`로 따로 센다. 운영 한도는 한 주소에서 방 생성 분당 5개, 새 세션 분당 30개이므로 `--rooms 10 --players 9`는 준비에만 몇 분이 걸린다. 플레이 중 429는 오류다.

## 출력

| 필드 | 뜻 |
|---|---|
| `requests` | 보낸 HTTP 요청 수(준비 단계의 429 포함) |
| `errorCount`, `errors` | 오류 총수와 코드별 수. 키는 `HTTP상태:오류코드`(예: `409:STALE_STATE`), `NETWORK`, `WS_ROOM_GONE`처럼 예상하지 않은 소켓 종료 메시지, `SETUP_FAILED` |
| `latencyMs.p50`, `latencyMs.p95` | 응답 본문까지 받은 HTTP 지연의 중앙값과 95백분위(밀리초) |
| `reconnects` | 의도하지 않게 닫혀 다시 연결한 소켓 수 |
| `setupWaits` | 준비 단계에서 `Retry-After`만큼 기다린 횟수 |
| `commandsApplied` | 서버가 `APPLIED`로 확정한 명령 수 |
| `durationSeconds`, `playSeconds` | 전체 실행 시간과 플레이 시작부터 끝까지의 시간 |

## 운영 서버에 쓸 때

운영 서버에는 일부러 정한 때에만 실행한다. 운영 방 한도가 10개이므로 `--rooms 10`은 실행 중 실제 사용자가 방을 만들지 못하게 하고, 이미 방이 있으면 `ROOM_LIMIT` 오류가 난다. 실행 중에는 서버에서 `docker stats`로 backend 컨테이너의 메모리를 함께 기록한다. 이 출력과 메모리 기록이 R4의 메모리 한도를 유지할지 바꿀지 판단하는 근거다.

## 로컬 확인

로컬 서버는 기본 프로필(운영과 같은 빈도 제한)에 이 도구의 Origin만 허용하여 띄운다.

```bash
backend/gradlew -p backend :server:bootRun --args=--poker.allowed-origins=http://127.0.0.1:8080
node deploy/load/load-rooms.mjs --url http://127.0.0.1:8080 --rooms 2 --players 3 --minutes 1
```

`errorCount`가 0이고 `curl -s http://127.0.0.1:8080/internal/deploy/status`의 `rooms`가 0으로 돌아오면 정상이다.
