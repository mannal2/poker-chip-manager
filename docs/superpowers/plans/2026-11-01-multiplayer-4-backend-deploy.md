# 멀티플레이 계획 4: 백엔드 배포·운영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 진행 중 게임을 보호하면서 백엔드를 현재 EC2에 자동 배포하고, 요청 빈도 제한과 복구 절차를 갖춰 `pcm.jwlee.xyz`에서 멀티플레이를 공개할 준비를 끝낸다.

**Architecture:** 백엔드는 `poker` Compose 프로젝트의 별도 서비스이며 edge Nginx만 `/api/`와 `/ws`로 접근한다. 배포 스크립트는 컨테이너 내부 loopback 전용 `/internal/deploy/*`로 새 시작 차단과 진행 게임 없음을 원자적으로 확인하고, 차단 상태를 파일에도 남겨 재시작 뒤에도 닫아 둔다. 시작 차단을 시간으로 자동 해제하지 않는다.

**Tech Stack:** Spring Boot 4.1.2, Java 25, Docker, Docker Compose, Bash, GitHub Actions, GHCR, edge Nginx, Playwright, Node 24 부하 스크립트.

**Spec:** [DEPLOYMENT_SPEC.md](../../../DEPLOYMENT_SPEC.md), [MULTIPLAYER_MODE.md](../../../MULTIPLAYER_MODE.md) 9·17절, [SYSTEM_SPEC.md](../../../SYSTEM_SPEC.md) 11·15절, TECH_DECISIONS T49~T54, [deploy/README.md](../../../deploy/README.md), [도메인 전환 절차](../../../deploy/edge/DOMAIN_SETUP.md). 서버 환경은 Oracle A1이 아니라 MULTIPLAYER_MODE 17절의 EC2가 기준이다.

## 범위

| 포함 | 제외 |
|---|---|
| C08, 요청 빈도 제한, 배포 게이트, 백엔드 이미지, 배포·복구 스크립트, CI, edge 라우팅, 재시작 E2E, 부하 도구, 공개 절차 | 여러 서버 인스턴스, 자동 장애 알림, 온라인 규약 버전 2 |

## 이번에 확정한 결정 (2026-11-01 사용자 확정)

- 게이트는 DEPLOYMENT_SPEC 4절 전체를 구현한다: 내부 prepare, 시작 차단 파일, RECOVERY_REQUIRED.
- 빈도 제한은 외부 라이브러리 없이 Spring 필터의 메모리 토큰 버킷으로 구현한다.
- 온라인 E2E는 모든 PR에서 핵심 흐름을 Chromium으로, main 배포 전에는 전체를 두 브라우저로 실행한다.
- EC2 사양은 Task 1에서 실제로 확인한 뒤 메모리 한도를 정한다.

계획 작성 중 다음 사항도 정했다.

- 관리 경로는 별도 포트 없이 `/internal/deploy/*`이고 loopback 요청만 받는다. edge는 이 경로를 전달하지 않으며 스크립트는 `docker compose exec`로 호출한다.
- 방 반복 생성을 막기 위해 명세에 없는 값을 추가한다: `POST /api/rooms`는 IP당 분당 5개, 순간 5개다. 측정 전 초기값이다.
- 429는 서버 장부에 닿지 않으므로 화면은 결과 불명과 같이 다룬다. 같은 requestId·순번을 유지하고 새 순번을 쓰지 않는다.
- 배포 판단은 이력 조상 검사로 하고, 보류(HELD)는 실패가 아니라 작업 요약의 안내로 끝낸다.
- 양쪽이 바뀐 배포는 백엔드를 먼저 한다. 백엔드가 보류되면 프런트 배포도 보류한다.

## 사용자 작업

`[사용자]`로 표시한 단계는 구현자가 대신하지 않는다. 서버 접속, push, PR, main 병합, edge 적용, 비밀값 등록, 실기기 확인이 여기에 해당한다. 구현자는 명령과 판단 기준을 문서로 남기고, 결과를 받기 전에는 완료로 표시하지 않는다.

## Global Constraints

- 빈도 제한(SYSTEM_SPEC 15절): 세션 명령 초당 5개·순간 10개, 비인증 생성·참가·복구 시도 IP당 분당 60개·순간 20개, 서버 전체 세션 2,000개. 한도는 접수 전에 거절하고 highWatermark를 바꾸지 않는다. 조회·생존 응답은 명령 한도와 분리한다.
- 동일 Wi-Fi 9명의 정상 참가·조작을 IP 제한으로 막지 않는다.
- 게이트: 시간이 지났다는 이유로 차단을 자동 해제하지 않는다. 파일을 읽지 못하거나 미완료 배포가 있으면 새 게임 시작을 닫고 기동한다. 정상 확인은 최대 120초다. 새 backend도 확인 중에는 새 게임을 받지 않는다.
- 진행 중이면 HELD로 끝내고 교체하지 않는다. 대기방·결과 화면은 배포를 막지 않으며, 방이 사라질 수 있음을 화면에 안내한다.
- 게이트가 닫혀 있으면 종료 취소도 거절하고 `서버 업데이트 중이라 취소할 수 없습니다`를 표시한다.
- 관리 경로는 공개 Nginx에 노출하지 않는다. 일반 세션은 접근할 수 없다. 요청마다 deploymentId와 프로세스 식별을 확인한다.
- 이미지는 비공개 `ghcr.io/mannal2/poker-chip-manager-backend`이고 Compose 실행은 digest로 고정한다. 키·쿠키·PAT를 이미지·빌드 인자·로그·저장소에 넣지 않는다.
- backend 포트는 호스트에 publish하지 않는다. 일반 앱 배포로 edge를 재시작하지 않는다. 전체 `docker system prune`을 쓰지 않는다.
- WS 프록시: Upgrade·Connection 전달, HTTP/1.1, `proxy_read_timeout 75s`, Docker DNS 재조회. API 오류에 SPA fallback을 적용하지 않는다.
- 로그: 컨테이너당 10MiB × 3개. 쿠키·비밀키·요청 본문·CSRF 토큰·전체 초대 URL을 남기지 않는다.
- `/local/`의 오프라인 동작과 프런트 단독 배포는 그대로다. 프런트만 바뀐 배포는 backend를 재시작하지 않는다.
- 새 함수·클래스·셸 함수와 테스트, 새 타입에는 역할을 설명하는 한글 주석을 한 줄 둔다. 문장 끝에 마침표를 찍지 않는다. 작업 완료 전에 Prettier와 주석 누락을 확인한다. 리뷰의 누락 지적은 미루지 않는다.
- 작업마다 관련 검증 후 로컬 커밋한다. push·PR·병합·배포는 별도 요청이 있을 때만 한다.

## Review Focus

1. **같은 Wi-Fi 참가:** 9명이 한 IP로 연달아 참가하고 게임해도 제한에 걸리면 안 된다. → Task 2 `RateLimitFilterTest`.
2. **시작과 배포 준비의 경합:** 게임 시작과 prepare가 겹치면 시작 성공 또는 배포 허용 중 하나만 성립해야 한다(O03). → Task 3 동시성 테스트.
3. **429 뒤 순번:** 제한에 걸린 명령 뒤 다음 명령이 `SEQUENCE_GAP`이 되면 안 된다. → Task 2 컨트롤러 테스트.
4. **배포 도중 끊김:** prepare 뒤 러너가 사라져도 새 시작은 닫혀 있고, 안전한 복구 뒤에만 열려야 한다(O04). → Task 6 스크립트 테스트.
5. **백엔드 보류와 프런트:** 진행 중 게임으로 backend가 HELD이면 그 backend에 의존하는 프런트가 먼저 나가면 안 된다. → Task 7 워크플로 판정 테스트.

---

### Task 1: 서버 확인과 CI 기준선

**Files:**
- Create: `deploy/check-host.sh`
- Modify: `deploy/README.md`, `TECH_DECISIONS.md`

**Interfaces:**
- Produces: `deploy/check-host.sh`는 읽기 전용이다. 아키텍처, 총·가용 메모리, 스왑, 디스크, Docker·Compose 버전, 실행 중 컨테이너의 메모리, `https://pcm.jwlee.xyz/local/` 응답을 출력한다. 비밀값을 출력하지 않는다.

- [ ] **Step 1: 스크립트 작성** 위 항목을 `key=value`로 출력하고, `shellcheck`가 있으면 통과시킨다.
- [ ] **Step 2: 검증** Run: `bash -n deploy/check-host.sh`, `bash deploy/check-host.sh` / Expected: 로컬에서도 없는 항목은 `unknown`으로 끝나고 exit 0
- [ ] **Step 3: [사용자] 서버에서 실행** 출력을 구현자에게 전달한다. 도메인 전환이 끝나지 않았으면 [DOMAIN_SETUP.md](../../../deploy/edge/DOMAIN_SETUP.md)를 먼저 마친다.
- [ ] **Step 4: [사용자] CI 기준선 확인** 현재 브랜치를 push하고 PR을 열어 `Backend CI`와 `CI and images`의 첫 결과를 확인한다.
- [ ] **Step 5: 값 결정과 기록** 아래 규칙으로 정해 `TECH_DECISIONS.md`에 기록한다.
  - `BACKEND_MEM_LIMIT = min(2GiB, 가용 메모리 - 512MiB)`, Java 힙은 그 50%
  - 결과가 768MiB보다 작으면 멈추고 사용자에게 서버 증설 또는 스왑 여부를 묻는다
  - 이미지 플랫폼은 확인한 아키텍처를 쓴다
- [ ] **Step 6: 커밋** `git commit -m "docs: record the deployment host baseline"`

### Task 2: 요청 빈도 제한과 세션 한도

**Files:**
- Create: `backend/server/.../support/TokenBuckets.java`, `.../api/RateLimitFilter.java`, `.../auth/SessionLimitListener.java`
- Modify: `.../api/ApiFilterConfig.java`, `.../api/ApiExceptionHandler.java`, `.../api/ApiError.java`, `.../auth/SessionController.java`, `backend/server/src/main/resources/application.yaml`
- Modify: `frontend/src/features/online-game/api/client.ts`, `frontend/src/features/gameplay/model/errorMessages.ts`
- Test: `.../support/TokenBucketsTest.java`, `.../api/RateLimitFilterTest.java`, `.../auth/SessionLimitTest.java`, `frontend/tests/online-game/client.test.ts`, `frontend/tests/online-game/onlineController.test.ts`

**Interfaces:**
- Produces:
  - `TokenBuckets(double perSecond, int burst, int maxKeys, Duration idle, Clock clock)`, `boolean tryTake(String key)`. 키 수는 `maxKeys`로 제한하고 오래 쓰지 않은 키를 먼저 지운다. 표가 가득 차면 새 키를 거절한다.
  - 응답 429 `{code:"RATE_LIMITED", message}`와 `Retry-After` 헤더. 세션 한도 초과는 503 `{code:"SESSION_LIMIT"}`와 `Retry-After`다.
  - 설정 `poker.client-ip-header`: 기본은 빈 값이고 `remoteAddr`를 쓴다. `prod`에서만 `X-Real-IP`다.

규칙:
- 세션 버킷 대상: `POST /api/rooms/{id}/commands`, `/control`. 초당 5개, 순간 10개.
- IP 버킷 대상: `POST /api/rooms`, `/api/room-joins`, `/api/recovery-requests`. 분당 60개, 순간 20개. `POST /api/rooms`는 추가로 분당 5개, 순간 5개다.
- `GET`, `/api/session*`, `/ws`의 생존 응답은 대상이 아니다.
- 필터는 장부보다 앞에서 동작한다. 응답에 비밀값을 넣지 않는다.
- `ApiClient`는 429와 503 `SESSION_LIMIT`를 결과 불명으로 돌려주되 `retryAfter`를 담는다. 컨트롤러는 같은 요청을 보관하고, 자동 재전송 없이 재시도 안내를 보여 준다.

- [ ] **Step 1: 실패 테스트 작성**
  - `TokenBucketsTest`: 순간 한도까지 허용하고 다음은 거절한다. 시계를 진행하면 회복한다. 키 수가 한도를 넘지 않는다.
  - `RateLimitFilterTest`: 세션 초당 5개를 넘으면 429이고 장부 순번이 그대로라 같은 요청이 회복 뒤 APPLIED다. `GET state`는 제한되지 않는다. 한 세션의 제한이 다른 세션에 영향을 주지 않는다. 같은 IP 9명이 참가하고 각자 초당 1개 명령을 보내도 429가 없다. 방 생성 6번째는 429다. `prod`가 아니면 위조한 `X-Real-IP`를 믿지 않는다.
  - `SessionLimitTest`: 한도를 3으로 주면 4번째 새 세션이 503이고 기존 세션은 유지된다.
  - 프런트: 429 뒤 `pending`이 유지되고 재시도가 같은 requestId·sequence로 나간다. 그 뒤 다음 명령의 순번은 하나만 늘어난다.
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*TokenBuckets*' --tests '*RateLimit*' --tests '*SessionLimit*'` 그리고 `npm --prefix frontend test -- --run tests/online-game` / Expected: FAIL
- [ ] **Step 3: 구현** 위 규칙대로 구현한다. 서버 전체 WS 500개는 이미 있으므로 건드리지 않는다.
- [ ] **Step 4: 통과 확인** Run: `backend/gradlew -p backend test`, `npm --prefix frontend test -- --run`, `npm --prefix frontend run test:e2e:online` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(server): limit request rates and sessions"`

### Task 3: 서버 배포 게이트

**Files:**
- Create: `.../room/StartGate.java`, `.../ops/DeployController.java`, `.../ops/LoopbackOnlyFilter.java`, `.../ops/GateFile.java`
- Modify: `.../room/StartConditions.java`, `.../room/GameCommands.java`, `.../room/CommandPipeline.java`, `.../room/RoomEnv.java`, `.../room/SnapshotWriter.java`, `.../registry/RoomRegistry.java`, `.../auth/SecurityConfig.java`, `.../auth/OriginFilter.java`, `backend/server/src/test/.../ArchitectureTest.java`
- Test: `.../room/StartGateTest.java`, `.../registry/DeployPrepareRaceTest.java`, `.../ops/DeployControllerTest.java`, `.../ops/GateFileTest.java`

**Interfaces:**
- Produces:
  - `StartGate`: `boolean isClosed()`, `Optional<String> deploymentId()`, `boolean close(String id)`, `boolean open(String id)`. 다른 배포가 닫아 둔 상태면 false다.
  - `RoomRegistry.prepareDeployment(String id): PrepareResult(boolean ready, int activeTournaments)`
  - `POST /internal/deploy/prepare {deploymentId}` → `{result:"READY"|"HELD", processId, activeTournaments}`, 다른 배포가 진행 중이면 409 `DEPLOY_IN_PROGRESS`
  - `GET /internal/deploy/status` → `{processId, startsClosed, deploymentId, activeTournaments, rooms}`
  - `POST /internal/deploy/release {deploymentId, processId}` → 200, 불일치면 409
  - `GateFile.read(Path): GateFile.State`: 파일 없음은 `OPEN`, `{"deploymentId","phase":"COMPLETE"}`은 `OPEN`, 그 밖의 값과 읽기 실패는 `CLOSED`
  - 설정 `poker.deploy.gate-file`, 스냅샷 `deployPending: boolean`
  - 코드 `DEPLOY_PENDING`(시작), `UNDO_DEPLOY_PENDING`(종료 취소). 둘 다 422
  - 패키지 `ops`는 `room`·`registry`에 의존하고, `ArchitectureTest`에 방향을 추가한다.

규칙:
- 순서가 경합을 막는다: `prepareDeployment`는 공용 잠금 안에서 게이트를 먼저 닫고, 그다음 방마다 방 잠금으로 진행 여부를 확인한다. `START`는 방 잠금 안에서 게이트를 읽는다.
- 진행 중 방이 있으면 게이트를 다시 열고 HELD를 돌려준다.
- 게이트가 닫히거나 열릴 때 PLAYING이 아닌 방의 버전을 올려 스냅샷을 발행한다. `activeTournaments`는 `RoomPhase.PLAYING`인 방의 수다.
- 게이트가 닫힌 동안 `status == ENDED`에서의 UNDO는 거절한다. 그 밖의 진행 중 명령은 막지 않는다.
- `LoopbackOnlyFilter`는 `remoteAddr`가 loopback이 아니면 404다. 전달 헤더를 보지 않는다. `/internal/**`는 CSRF·Origin·세션 검사에서 제외한다.
- 기동할 때 `GateFile`이 `CLOSED`면 파일의 deploymentId로 게이트를 닫은 채 시작한다. deploymentId를 알 수 없으면 `unknown`으로 닫는다.

- [ ] **Step 1: 실패 테스트 작성**
  - `StartGateTest`: 같은 id는 멱등이고 다른 id는 거절된다.
  - `DeployPrepareRaceTest`: 스레드로 START와 prepare를 100회 경합시켜 `시작 성공 + READY`가 함께 나오지 않는다(O03).
  - `DeployControllerTest`: 진행 게임이 있으면 HELD이고 새 게임 시작이 가능하다. 대기방만 있으면 READY이고 START가 `DEPLOY_PENDING`이다. release 뒤 시작된다. `processId`가 틀리면 409다. 비loopback은 404이고 CSRF 없이 loopback은 동작한다. 결과 화면 UNDO가 닫힌 동안 `UNDO_DEPLOY_PENDING`이고, 일반 베팅은 계속된다.
  - `GateFileTest`: 없음, COMPLETE, 진행 단계, 깨진 JSON, 읽기 권한 없음을 검사한다. 닫힌 파일로 기동하면 START가 거절된다(O06).
- [ ] **Step 2: 실패 확인** Run: `backend/gradlew -p backend :server:test --tests '*StartGate*' --tests '*DeployPrepareRace*' --tests '*DeployController*' --tests '*GateFile*'` / Expected: FAIL
- [ ] **Step 3: 구현** 위 규칙대로 구현한다. 스냅샷 모양이 바뀌므로 `shared/api-contract` 예시를 이 작업에서 다시 만든다.
- [ ] **Step 4: 통과 확인** Run: `backend/gradlew -p backend test` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(server): add the deployment gate"`

### Task 4: 게이트 화면 안내

**Files:**
- Modify: `frontend/src/features/online-game/api/types.ts`, `frontend/src/features/online-game/RoomPage.tsx`, `frontend/src/features/online-game/styles/online.css`, `frontend/src/features/gameplay/model/errorMessages.ts`
- Test: `frontend/tests/online-game/contract.test.ts`, `roomManagement.test.tsx`, `frontend/e2e/online/deploy-gate.spec.ts`

규칙: `DEPLOY_PENDING`은 `서버 업데이트가 끝나면 시작할 수 있습니다`, `UNDO_DEPLOY_PENDING`은 `서버 업데이트 중이라 취소할 수 없습니다`다. `deployPending`이면 대기방·결과 화면 상단에 `서버 업데이트 중입니다. 방이 사라질 수 있습니다`를 표시한다. 진행 화면에는 표시하지 않는다.

- [ ] **Step 1: 실패 테스트 작성** 단위: `RoomSnapshot` 타입 가드가 `deployPending`을 요구하고, 안내가 대기방·결과에서만 보인다. `deploy-gate.spec.ts`: Playwright `request`가 `http://127.0.0.1:8080/internal/deploy/prepare`를 호출하면 안내가 나오고 게임 시작이 문구로 거절되며, release 뒤 시작된다. 이 스펙은 서버 전체 게이트를 바꾸므로 `workers: 1`인 별도 프로젝트로 다른 스펙 뒤에 실행한다.
- [ ] **Step 2: 실패 확인** Run: `npm --prefix frontend run test:e2e:online -- deploy-gate` / Expected: FAIL
- [ ] **Step 3: 구현** 위 규칙대로 구현한다.
- [ ] **Step 4: 통과 확인** Run: `npm --prefix frontend test -- --run`, `npm --prefix frontend run test:e2e:online` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(online): explain server updates on the room screens"`

### Task 5: 백엔드 이미지·Compose·edge 설정

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `deploy/test-backend-image.sh`
- Modify: `compose.yaml`, `deploy/edge/nginx/pcm.conf`, `backend/server/src/main/resources/application.yaml`, `.../api/HealthController.java`

**Interfaces:**
- Produces: 이미지는 `bootJar`를 담은 `eclipse-temurin:25-jre` 기반이고 `curl`을 포함하며 비루트 사용자로 실행한다. `SPRING_PROFILES_ACTIVE=prod`, `JAVA_TOOL_OPTIONS`로 힙을 받는다. 라벨 `org.opencontainers.image.revision`을 빌드 인자로 받는다.
- Compose `backend`: `image: ${BACKEND_IMAGE:?}`, `mem_limit: ${BACKEND_MEM_LIMIT:?}`, alias `poker-backend`, `poker-edge` 네트워크, publish 없음, `restart: unless-stopped`, `.local/deploy/gate:/run/poker-gate:ro`, 로그 10MiB × 3개, `stop_grace_period: 30s`.
- `pcm.conf`: `map $http_upgrade $connection_upgrade`, `location /api/`와 `location = /ws`가 `$poker_backend`(`poker-backend:8080`, 변수로 Docker DNS 재조회)로 전달한다. `/ws`는 Upgrade를 전달하고 `proxy_read_timeout 75s`다. 전달 헤더는 값을 덮어쓴다. `/internal/`은 프런트로 가지 않고 404다.
- 건강 응답 `version`에 커밋 SHA를 담는다.

- [ ] **Step 1: 실패 검사 작성** `deploy/test-backend-image.sh`: 이미지를 빌드해 기동하고 `/api/health` 200, 실행 사용자 비루트, `/internal/deploy/status`는 컨테이너 안 loopback에서 200이고 호스트의 게시 포트로는 닿지 않음을 확인한다. `prod` 프로파일의 쿠키가 `__Host-`다.
- [ ] **Step 2: 실패 확인** Run: `bash deploy/test-backend-image.sh` / Expected: FAIL
- [ ] **Step 3: 구현** 위 파일을 작성한다. 설정 검사: `docker compose config -q`, `docker run --rm -v "$PWD/deploy/edge/nginx:/etc/nginx/conf.d:ro" nginx:stable-alpine nginx -t`는 인증서가 없어 실패하므로, 테스트용 자체 서명 파일을 임시로 마운트해 검사한다.
- [ ] **Step 4: 통과 확인** Run: `bash deploy/test-backend-image.sh`, 위 설정 검사 / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "build: package the backend and route it through edge"`

### Task 6: 백엔드 배포·복구·정리 스크립트

**Files:**
- Create: `deploy/deploy-backend.sh`, `deploy/recover-backend.sh`, `deploy/prune-images.sh`, `deploy/test-deploy-backend.sh`
- Modify: `deploy/deploy-frontend.sh`, `deploy/README.md`

**Interfaces:**
- Consumes: Task 3 `/internal/deploy/*`, Task 5 Compose.
- Produces:
  - `deploy-backend.sh <image@sha256> <40자 커밋> <origin> <deploymentId>`. 종료 코드: 0 `DEPLOYED`, 3 `HELD`, 1 실패, 2 입력 오류.
  - 상태 파일 `.local/deploy/backend-current`, `backend-lastHealthy`, `backend-pending`, `gate/start-gate.json`. 모두 임시 파일 뒤 `mv`로 교체한다.
  - `recover-backend.sh`: 같은 잠금을 얻고 이미지·단계·health를 검사해 완료하거나 롤백한다.
  - `prune-images.sh`: 현재·직전 정상·보류 대상과 최근 성공 빌드 5개를 잠금 안에서 다시 계산해 보호하고 나머지 이 프로젝트 이미지만 지운다.

순서는 DEPLOYMENT_SPEC 4절의 1~7을 그대로 따른다. 프런트와 같은 `.local/deploy/lock`을 쓴다. 첫 배포는 실행 중 backend가 없을 수 있으므로 prepare를 건너뛰고, 실패하면 이전 정상이 없음을 구분해 보고한다(O07). 정상 확인은 edge를 거친 `/api/health`의 커밋 일치, 프런트 HTML, `/ws` 업그레이드 요청의 백엔드 응답(세션 없음 401)이다. `deploy-frontend.sh`는 `backend-pending`이 있으면 멈춘다.

- [ ] **Step 1: 실패 테스트 작성** (`test-deploy-frontend.sh`처럼 Docker·HTTP·시간을 모의)
  - 정상 배포, 첫 배포, HELD 교체 없음, 파일 기록 실패 시 교체 없음과 차단 해제, 교체 직전 재확인 불일치
  - 정상 확인 실패 후 롤백 성공(결과는 실패), 롤백 실패 시 `RECOVERY_REQUIRED`
  - prepare 뒤 스크립트 강제 종료 시 차단 파일이 남고, 시간이 지나도 다음 실행이 거절되며, 복구 뒤에만 열림(O04)
  - 복구 스크립트가 잠금을 쥔 다른 배포를 기다리지 않고 거절됨
  - 정리가 보호 digest와 다른 프로젝트 이미지를 지우지 않음(O10)
- [ ] **Step 2: 실패 확인** Run: `bash deploy/test-deploy-backend.sh` / Expected: FAIL
- [ ] **Step 3: 구현** 위 규칙대로 구현한다. `set -euo pipefail`, `umask 077`을 쓴다.
- [ ] **Step 4: 통과 확인** Run: `bash -n deploy/*.sh`, `bash deploy/test-deploy-backend.sh`, `bash deploy/test-deploy-frontend.sh` / Expected: PASS
- [ ] **Step 5: 커밋** `git commit -m "feat(deploy): deploy and recover the backend safely"`

### Task 7: CI와 배포 워크플로

**Files:**
- Modify: `.github/workflows/ci-images.yml`, `.github/workflows/backend-ci.yml`, `frontend/playwright.online.config.ts`, `frontend/e2e/online/host-tools.spec.ts`
- Create: `.github/workflows/deploy.yml`, `deploy/plan-release.sh`, `deploy/test-plan-release.sh`

**Interfaces:**
- Produces:
  - `plan-release.sh <backendChanged> <frontendChanged> <backendResult>`가 `frontend=deploy|hold|skip`을 출력한다. 양쪽이 바뀌고 backend가 `held` 또는 `failed`이면 `hold`다.
  - `deploy.yml`: `workflow_dispatch(ref)`로 이미 게시한 digest를 다시 배포한다. HELD 뒤 재실행 경로이고, 같은 concurrency 그룹을 쓰며 진행 중 작업을 취소하지 않는다.
  - 60초 시험에 `@slow` 태그. `--project=chromium --grep-invert @slow`가 PR 핵심 범위다.

규칙:
- PR: 기존 프런트 검사에 백엔드 전체 테스트, 온라인 E2E 핵심, `test-deploy-backend.sh`, `test-plan-release.sh`, 백엔드 이미지 빌드를 더한다.
- main: 온라인 E2E 전체를 통과한 뒤 바뀐 서비스만 이미지를 게시한다. 변경 판별은 직전 배포 커밋과의 `git diff`이고, 판별할 수 없으면 양쪽을 배포한다.
- 조상 검사: 일반 실행은 대상 커밋이 서비스별 현재 커밋의 후손일 때만 진행한다. 판별할 수 없으면 중단한다.
- HELD는 `$GITHUB_STEP_SUMMARY`에 재실행 방법을 남기고 작업을 성공으로 끝낸다.
- 러너에서 x86 이미지를 x86 서버에 쓰는 경우에도 실제 서버 기동 확인은 배포 스크립트가 맡는다. 다른 아키텍처면 Task 1의 값으로 네이티브 러너를 쓴다.

- [ ] **Step 1: 실패 테스트 작성** `test-plan-release.sh`: 변경 조합 표 전체를 검사한다. 특히 양쪽 변경 + held는 `hold`, 프런트만 변경은 backend 결과와 무관하게 `deploy`다.
- [ ] **Step 2: 실패 확인** Run: `bash deploy/test-plan-release.sh` / Expected: FAIL
- [ ] **Step 3: 구현** 워크플로를 수정한다. 액션은 기존처럼 커밋 SHA로 고정한다.
- [ ] **Step 4: 통과 확인** Run: `bash deploy/test-plan-release.sh`, `npx --prefix frontend playwright test --config frontend/playwright.online.config.ts --project=chromium --grep-invert @slow`, YAML 문법 검사 / Expected: PASS
- [ ] **Step 5: [사용자] PR에서 실제 실행 확인** Actions 결과를 구현자에게 전달한다. 로컬 통과를 CI 통과로 기록하지 않는다.
- [ ] **Step 6: 커밋** `git commit -m "ci: test, publish and deploy the backend"`

### Task 8: 재시작 E2E와 부하 도구

**Files:**
- Create: `frontend/playwright.restart.config.ts`, `frontend/e2e/restart/server-restart.spec.ts`, `frontend/e2e/restart/backendProcess.ts`, `deploy/load/load-rooms.mjs`, `deploy/load/README.md`
- Modify: `frontend/package.json`, `.github/workflows/ci-images.yml`

**Interfaces:**
- Produces: `startBackend(): Promise<BackendProcess>`, `BackendProcess.stop(): Promise<void>`(프로세스 트리까지 종료). 스크립트 `test:e2e:restart`. 부하 스크립트 인자는 `--url --rooms 10 --players 9 --minutes N`이고, 요청 수·오류 코드별 수·응답 지연 p50/p95·재연결 수를 JSON으로 출력한다.

- [ ] **Step 1: 재시작 E2E 작성** 게임 진행 중 서버를 재시작하면 45초 안에 소실 안내가 나오고 `입장 화면으로` 링크에 방 코드가 있다. 새 방을 만들 수 있다. 이전 요청이 새 방에 적용되지 않는다(M16).
- [ ] **Step 2: 통과 확인** Run: `npm --prefix frontend run test:e2e:restart` / Expected: PASS
- [ ] **Step 3: 부하 스크립트 작성** 실제 쿠키·CSRF·Origin·WebSocket으로 참가자를 만들고 PING에 응답한다. 사람처럼 명령 사이에 1초 이상 쉬어 빈도 제한을 시험하지 않는다.
- [ ] **Step 4: 로컬 확인** Run: `node deploy/load/load-rooms.mjs --url http://127.0.0.1:8080 --rooms 2 --players 3 --minutes 1` / Expected: 오류 0
- [ ] **Step 5: main 배포 전 CI 편입** 재시작 E2E를 main 경로에만 넣는다.
- [ ] **Step 6: 커밋** `git commit -m "test: cover server restarts and add a load tool"`

### Task 9: 공개 절차와 문서

**Files:**
- Modify: `DEPLOYMENT_SPEC.md`, `deploy/README.md`, `frontend/DEVICE_CHECKS.md`, `ARCHITECTURE.md`, `MULTIPLAYER_MODE.md`, `SYSTEM_SPEC.md`, `TECH_DECISIONS.md`, `IMPLEMENTATION_PROGRESS.md`
- Create: `deploy/GO_LIVE.md`

- [ ] **Step 1: 문서 갱신**
  - `DEPLOYMENT_SPEC.md`: Oracle 전제를 실제 EC2 값으로 고치고 구현과 다른 곳을 표시한다.
  - `deploy/README.md`: backend 배포·복구·정리와 운영 확인 명령(서비스 상태, digest, 방 수, 오류, 메모리, 디스크, 인증서)
  - `TECH_DECISIONS.md`: 게이트, 빈도 제한, 방 생성 한도, 관리 경로, CI 범위
  - `frontend/DEVICE_CHECKS.md`: 동일 Wi-Fi 9명, iPhone 잠금 복귀, 설치 앱 안 `/online/`, 초대 링크, 긴 이름의 복구 알림
- [ ] **Step 2: `deploy/GO_LIVE.md` 작성** 순서를 고정한다: 서버 `.env`·GHCR 읽기 권한 → 게이트 디렉터리 → backend 첫 배포 → edge 적용(`nginx -t` 뒤 graceful reload) → HTTPS·WS 확인 → 프런트 배포 → 실기기 확인 → 부하 측정 → 앱 홈 안내 공개. 단계마다 확인 명령과 되돌리는 방법을 쓴다. 프런트에 온라인 버튼이 이미 켜져 있으므로, **백엔드 없는 상태로 main에 병합하면 사용자에게 오류 화면이 보인다.** 병합 순서를 첫 단계에서 다룬다.
- [ ] **Step 3: 최종 검증** Run: `backend/gradlew -p backend test`, `npm --prefix frontend run lint`, `npm --prefix frontend run typecheck`, `npm --prefix frontend test -- --run`, `npm --prefix frontend run build`, `npm --prefix frontend run test:e2e`, `npm --prefix frontend run test:e2e:online`, `npm --prefix frontend run test:e2e:restart`, `bash deploy/test-deploy-frontend.sh`, `bash deploy/test-deploy-backend.sh`, `bash deploy/test-plan-release.sh` / Expected: 모두 PASS
- [ ] **Step 4: 주석과 형식 스캔** 추가한 함수·클래스·타입·셸 함수·테스트의 한글 주석과 Prettier를 전수 확인한다.
- [ ] **Step 5: 커밋** `git commit -m "docs: add the multiplayer go-live procedure"`
- [ ] **Step 6: [사용자] 공개 절차 실행** `deploy/GO_LIVE.md`대로 진행하고, 결과와 측정값을 `IMPLEMENTATION_PROGRESS.md`에 남긴다. 이 단계가 끝나야 O01~O12를 통과로 기록한다.

## 계획 뒤에 남는 항목

- 자동 장애 알림, 인증서 만료 알림(운영 README의 수동 확인으로 시작한다).
- 호환되지 않는 규약 변경을 위한 `protocolVersion` 목록(버전 2가 필요해질 때 만든다).
- `onlineController.ts` 추가 분리(동작 문제가 아니며, 이 파일을 크게 고칠 때 함께 한다).
