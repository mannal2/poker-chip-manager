# 멀티플레이 공개 절차

멀티플레이 백엔드를 처음 공개할 때 한 번 따르는 순서다. 모든 단계는 사용자가 직접 한다. 서버 접속, GitHub 설정, 병합, 실기기 확인은 자동화하지 않는다. 각 단계는 **할 일 → 확인 → 되돌리기** 순서로 적었다. 확인이 기대와 다르면 다음 단계로 넘어가지 않는다. 스크립트 자체의 설명은 [README.md](README.md), 요구사항은 [DEPLOYMENT_SPEC.md](../DEPLOYMENT_SPEC.md)에 있다.

이 문서의 명령은 아직 실제 서버에서 실행하지 않았다. 토큰·쿠키·키는 저장소·명령줄 인자·로그·이 문서의 기록란 어디에도 붙여 넣지 않는다.

**권한:** 배포 스크립트는 root로 `umask 077`에서 실행되므로, 자동 배포가 한 번이라도 돈 서버에서는 `.local/deploy`가 root 소유 0700, `.env`가 root 소유 0600일 것이다. 그래서 이 문서는 그 안을 읽는 명령에 모두 `sudo`를 붙였다. 이 권한은 스크립트에서 추론한 값이므로 처음 접속했을 때 `sudo stat -c '%a %U %n' .local .local/deploy .env`로 실제 값을 확인한다.

## 순서 한눈에

| 단계 | 내용 | 계획의 순서와 다른 점 |
|---|---|---|
| 1 | 병합 순서 정하기(아직 병합하지 않는다) | |
| 2 | 서버 `.env`와 GHCR 읽기 권한 | |
| 3 | 게이트 디렉터리와 `compose.yaml` | |
| 4 | edge 적용(`nginx -t` 뒤 graceful reload) | backend 첫 배포보다 **앞**으로 옮겼다 |
| 5 | Actions 준비와 `BACKEND_DEPLOY_ENABLED` | 계획의 첫 단계(병합 순서)에서 나온 일 |
| 5a | IP 주소의 멀티플레이 경로 처리(**사용자 결정**) | 계획에 없던 단계. 6단계 전에 정한다 |
| 6 | 병합 = backend 첫 배포 | 프런트 배포도 같은 실행에서 backend 결과에 따라 이어진다 |
| 7 | HTTPS·WS 확인 | |
| 8 | 프런트 배포 확인 | |
| 9 | 실기기 확인 | |
| 10 | 부하 측정 | |
| 11 | 앱 홈 안내 공개 | |

edge를 앞으로 옮긴 이유: `deploy-backend.sh`의 정상 확인은 edge를 거쳐 `/api/health`의 커밋, `/online/`의 HTML, `/ws`의 401을 본다(`backend-lib.sh`의 `check_edge`). edge가 아직 `/api/`와 `/ws`를 프런트로 보내면 첫 배포는 반드시 실패한다. 새 edge 설정은 backend 주소를 요청 때마다 Docker DNS로 찾으므로 backend가 없어도 `nginx -t`를 통과하고, 그동안 `/api/`·`/ws`만 502로 답한다. 지금 공개된 프런트는 이 경로를 쓰지 않는다.

backend와 프런트가 한 실행에 묶이는 이유: backend 이미지는 main에서만 발행되므로 병합 전에 backend를 따로 배포할 방법이 없다. 대신 같은 실행 안에서 backend가 먼저 배포되고, `plan-release.sh`가 backend가 `DEPLOYED`가 아니면 프런트를 보류한다. 그래서 backend 없이 온라인 버튼만 공개되는 일은 없다.

## 1. 병합 순서 정하기

지금 main의 앱 홈에는 `멀티플레이 모드 · 준비 중` 버튼이 비활성으로 있고 `/online/`은 준비 중 화면이다. 이 브랜치(PR #16)는 그 버튼을 켜고 실제 온라인 화면을 연결한다. **백엔드 없이 main에 병합하면 프런트만 배포되어 사용자가 버튼을 누르는 순간 오류 화면을 본다.** `BACKEND_DEPLOY_ENABLED`가 `true`가 아니면 워크플로가 backend를 건드리지 않고 프런트만 배포하기 때문이다.

**할 일:** 2~5단계를 마칠 때까지 PR #16을 병합하지 않는다. 5단계에서 변수를 켠 뒤 바로 6단계로 병합한다.

**확인:** PR #16이 열려 있고 main에 이 브랜치의 커밋이 없다.

```powershell
gh pr view 16 --json state,mergedAt
```

**되돌리기:** 실수로 먼저 병합했다면 main에서 병합 커밋을 되돌리는 PR을 만들어 병합한다. 변수가 꺼져 있으므로 이전 프런트가 다시 배포되어 버튼이 비활성으로 돌아온다. 그 사이 사용자는 오류 화면을 볼 수 있다.

## 2. 서버 `.env`와 GHCR 읽기 권한

EC2에 SSH로 접속해 `/home/ubuntu/poker-chip-manager`에서 실행한다.

**할 일 — 현재 상태 기록:** 되돌릴 때 쓸 값을 기록해 둔다. 아래 출력은 이미지 digest와 커밋뿐이고 비밀이 없다.

```bash
cd /home/ubuntu/poker-chip-manager
sudo cat .local/deploy/current          # 지금 프런트의 image=와 revision=. 8단계 되돌리기에 쓰므로 그대로 적어 둔다
sudo cp -p .env ".env.backup-$(date +%s)"
sudo cp -p compose.yaml "compose.yaml.backup-$(date +%s)"
```

**할 일 — `.env`:** 세 줄을 더한다(Ruling R4·R10). 첫 배포는 Actions가 하므로 배포할 digest를 아직 모른다. `BACKEND_IMAGE`에는 같은 형식의 자리표시자를 넣는다. 첫 배포에는 읽을 이전 backend가 없으므로 아무도 이 값을 내려받거나 실행하지 않고, 배포가 이 줄을 실제 digest로 바꾼다.

```bash
sudo grep -E '^(export[[:space:]]+)?BACKEND_' .env   # 아무것도 나오지 않아야 한다
printf '%s\n' \
  'BACKEND_IMAGE=ghcr.io/mannal2/poker-chip-manager-backend@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
  'BACKEND_MEM_LIMIT=768m' \
  'BACKEND_HEAP=384m' | sudo tee -a .env > /dev/null
```

**할 일 — GHCR 읽기 권한:** 배포 스크립트는 root로 실행되므로 root의 Docker가 비공개 backend 패키지를 읽어야 한다. 프런트 배포가 이미 root의 GHCR 로그인을 쓰고 있다. 그 자격이 `read:packages` 범위만 가진 classic PAT이면 같은 계정의 backend 패키지도 읽을 수 있으므로 바꾸지 않는다. 새로 로그인해야 한다면 `read:packages`만 가진 토큰을 만들고, 화면에 보이지 않게 입력한다.

```bash
read -rsp 'GHCR token: ' token; echo
printf '%s' "$token" | sudo docker login ghcr.io -u mannal2 --password-stdin; unset token
```

**확인:**

```bash
sudo grep -cE '^BACKEND_(IMAGE|MEM_LIMIT|HEAP)=' .env       # 3
sudo grep -c '"ghcr.io"' /root/.docker/config.json          # 1 이상. 파일 내용은 출력하지 않는다
sudo docker manifest inspect ghcr.io/mannal2/poker-chip-manager-frontend:main > /dev/null && echo ghcr-ok
```

backend 패키지는 6단계에서 처음 발행되므로 지금은 확인할 수 없다. 권한이 없으면 6단계의 `docker pull`에서 아무것도 바꾸기 전에 멈추고, 프런트도 보류된다.

**되돌리기:** 더한 세 줄만 지운다. 백업 전체를 되돌리면 그 사이 배포가 바꾼 `FRONTEND_IMAGE`까지 옛 값으로 돌아가므로, 백업은 비교용으로만 쓴다. 새로 로그인했다면 이전 토큰으로 다시 로그인한다.

```bash
sudo sed -i '/^BACKEND_\(IMAGE\|MEM_LIMIT\|HEAP\)=/d' .env
sudo grep -c '^BACKEND_' .env     # 0
```

## 3. 게이트 디렉터리와 `compose.yaml`

R10의 순서를 지킨다: `.env`(2단계) → 게이트 디렉터리 → `compose.yaml`. 새 `compose.yaml`은 세 변수가 없으면 읽히지 않고, 게이트 디렉터리가 없으면 backend를 만들지 않는다. 디렉터리가 없을 때 열린 게이트로 기동하는 일을 막기 위해서다(R7).

**할 일 — 게이트 디렉터리:**

```bash
cd /home/ubuntu/poker-chip-manager
sudo install -d -m 0755 .local/deploy/gate
```

**할 일 — `compose.yaml` 올리기:** Windows PowerShell의 저장소 루트에서 이 브랜치의 파일을 올린다. `100.x.x.x`는 서버 Tailscale IP다.

```powershell
$deployHost = '100.x.x.x'
scp -i "$env:USERPROFILE\.ssh\poker-actions" ./compose.yaml "ubuntu@${deployHost}:/home/ubuntu/poker-chip-manager/compose.yaml.upload"
```

서버에서 바꾼다.

```bash
cd /home/ubuntu/poker-chip-manager
sudo cp compose.yaml.upload compose.yaml
```

`docker compose up -d`를 서비스 이름 없이 실행하지 않는다. 자리표시자 이미지로 backend를 만들려다 실패한다. backend는 6단계의 배포 스크립트만 시작한다.

**확인:**

```bash
sudo stat -c '%a %n' .local/deploy/gate           # 755
sudo docker compose config -q && echo compose-ok
sudo docker compose config --services             # frontend, backend
sudo docker compose ps                            # frontend만 실행 중, 재시작되지 않았다
```

**되돌리기:** `sudo cp -p compose.yaml.backup-<시각> compose.yaml`. 빈 게이트 디렉터리는 남겨도 된다.

## 4. edge 적용

[DOMAIN_SETUP.md](edge/DOMAIN_SETUP.md) 3절과 같은 방식이다. 새 `pcm.conf`는 `/api/`·`/ws`를 backend로 보내고, `/internal/`은 404로 막고, 클라이언트가 보낸 `X-Real-IP`·`X-Forwarded-*`를 덮어쓴다. `/ws`는 HTTP/1.1, Upgrade·Connection 전달, `proxy_read_timeout 75s`다. reload는 기존 연결을 끊지 않고, edge 컨테이너를 재시작하지 않는다.

**할 일:** PowerShell에서 올린다.

```powershell
scp -i "$env:USERPROFILE\.ssh\poker-actions" ./deploy/edge/nginx/pcm.conf "ubuntu@${deployHost}:/home/ubuntu/edge/pcm.conf.upload"
```

서버에서 보관 → 설치 → 검사 → reload 한다. 검사가 실패하면 reload하지 않는다.

```bash
cd /home/ubuntu/edge
sudo cp -p nginx/pcm.conf "pcm.conf.backup-$(date +%s)"
sudo install -m 0644 pcm.conf.upload nginx/pcm.conf
sudo docker compose exec -T nginx nginx -t && \
  sudo docker compose exec -T nginx nginx -s reload
```

**확인:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://pcm.jwlee.xyz/local/                  # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://pcm.jwlee.xyz/online/                 # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://pcm.jwlee.xyz/api/health              # 502: backend가 아직 없다
curl -sS -o /dev/null -w '%{http_code}\n' https://pcm.jwlee.xyz/internal/deploy/status  # 404
```

**되돌리기:** `nginx -t` 실패 시 `sudo cp -p pcm.conf.backup-<시각> nginx/pcm.conf` 후 다시 검사한다. reload 뒤 `/local/`이 이상하면 같은 방법으로 되돌리고 검사·reload한다.

## 5. Actions 준비와 `BACKEND_DEPLOY_ENABLED`

**할 일 — 무암호 sudo:** 배포 계정이 `sudo -n bash -s`로 배포 기록을 읽는다. 실패하면 두 기록이 `unknown`이 되어 변수를 켠 모든 배포가 이력 조상 검사에서 멈춘다. `DEPLOY_USER` 비밀값과 같은 계정으로 확인한다(아래 예시는 `ubuntu`).

```powershell
ssh -i "$env:USERPROFILE\.ssh\poker-actions" "ubuntu@$deployHost" 'sudo -n bash -c true && echo sudo-ok'
```

**할 일 — Tailscale OIDC 신뢰:** 배포 작업은 `ci-images.yml`이 부르는 `deploy.yml` 안에서 Tailscale에 연결한다. Tailscale 관리 화면의 GitHub 신뢰 설정이 저장소·브랜치만 보면 그대로 둔다. 워크플로 파일까지 고정한다면 `.github/workflows/deploy.yml`(호출된 워크플로이자 수동 실행 대상)과 `.github/workflows/ci-images.yml`(`plan` 작업)을 모두 허용한다. 호출된 워크플로에서 받은 OIDC 토큰이 받아들여지는지는 실제 실행 전에는 증명되지 않았다. 거절되면 배포 작업이 서버에 닿기 전에 실패하므로 아무것도 바뀌지 않는다.

**권장 — main 보호:** main에는 지금 보호 규칙이 없다(GitHub API 404). 저장소 설정이므로 사용자가 결정한다. 공개 전에 다음을 권장한다.

- 강제 push와 삭제 막기. 배포 판단은 이력 조상 검사이므로 강제 push가 이력을 바꾸면 배포가 멈춘다.
- PR 필수, 필수 검사 `checks`, `backend / test`, `online-e2e`.

**할 일 — 비밀값 확인:** Settings → Secrets and variables → Actions에 `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY`가 있는지 이름만 본다.

**할 일 — 변수 켜기(R17):** 2~4단계와 위 확인이 모두 끝난 뒤 저장소 변수를 만든다. 지금 main의 워크플로는 이 변수를 읽지 않으므로 병합 전까지 효과가 없다.

```powershell
gh variable set BACKEND_DEPLOY_ENABLED --body true
```

**확인:**

```powershell
gh variable list        # BACKEND_DEPLOY_ENABLED  true
```

**되돌리기:** `gh variable set BACKEND_DEPLOY_ENABLED --body false`. 이후 main 실행은 프런트만 배포하고 backend는 그대로 둔다.

## 5a. IP 주소의 멀티플레이 경로 처리 (사용자 결정)

**사용자가 정해야 한다.** 같은 프런트가 `https://54.180.47.226`에서도 열린다(edge의 `default.conf`, 전환 기간에 유지). 이 서버 블록은 모든 경로를 프런트로 보내고 backend는 `https://pcm.jwlee.xyz` Origin만 받는다. 6단계 뒤 IP 주소의 앱 홈에도 켜진 멀티플레이 버튼이 보이지만, `/api/`·`/ws`가 프런트로 가서 누르면 오류 화면이 된다. MULTIPLAYER_MODE 17절은 IP 주소로 멀티플레이를 공개하지 않는다고 정했다.

| 선택 | 결과 |
|---|---|
| **권장: IP 주소의 `/online/`·`/api/`·`/ws`를 도메인으로 보낸다** | IP 주소에서 버튼을 누르면 `https://pcm.jwlee.xyz/online/`으로 이동한다. `/local/`과 IP 주소의 로컬 기록은 그대로다 |
| 그대로 둔다 | IP 주소 사용자는 버튼을 누르면 오류 화면을 본다. 이 위험을 받아들인다고 기록한다 |

권장안을 고르면 6단계 전에 아래를 적용한다. 저장소의 `deploy/edge/nginx/default.conf`는 바꾸지 않았으므로, 적용했다면 같은 변경을 나중에 저장소에도 반영한다.

**할 일:** 서버의 `/home/ubuntu/edge/nginx/default.conf`에서 `listen 443 ssl;`인 서버 블록의 `location / {` 바로 위에 다음 블록을 넣는다. 80번 서버 블록은 이미 모든 요청을 HTTPS로 보내므로 바꾸지 않는다.

```nginx
    # 멀티플레이는 도메인에서만 공개한다
    location ~ ^/(online|api|ws)(/|$) {
        return 308 https://pcm.jwlee.xyz$request_uri;
    }
```

```bash
cd /home/ubuntu/edge
sudo cp -p nginx/default.conf "default.conf.backup-$(date +%s)"
sudo nano nginx/default.conf        # 위 블록을 넣는다
sudo docker compose exec -T nginx nginx -t && \
  sudo docker compose exec -T nginx nginx -s reload
```

**확인:**

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://54.180.47.226/online/
# 308 https://pcm.jwlee.xyz/online/
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://54.180.47.226/api/health
# 308 https://pcm.jwlee.xyz/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://54.180.47.226/local/
# 200: 로컬 앱은 그대로
```

**되돌리기:** `sudo cp -p default.conf.backup-<시각> nginx/default.conf` 뒤 같은 `nginx -t`와 reload. `nginx -t`가 실패하면 reload하지 않고 같은 방법으로 되돌린다.

## 6. 병합 = backend 첫 배포

**할 일:** PR #16의 검사가 통과했는지 보고 병합한다. main 실행 "CI and images"가 다음 순서로 진행한다.

1. `checks`, `backend`, 두 브라우저 전체 `online-e2e`(`deploy-gate` 포함), `restart-e2e`
2. `plan`: 서버 기록을 읽는다. backend 기록이 없으므로(`absent`) 두 서비스 모두 바뀐 것으로 본다
3. `publish`, `publish-backend`: digest로 이미지 발행
4. `deploy`: backend 먼저 → backend가 `DEPLOYED`일 때만 프런트

첫 main 실행에서 특히 본다.

- `restart-e2e`는 main에서 처음 실행된다. 재시작 뒤 두 화면이 소실 안내를 보이기까지 45초 제한을 지켜야 한다. 작업 로그에서 테스트 시간과 여유를 확인하고, 제한에 가까우면 기록해 둔다.
- `online-e2e`는 PR에서는 Chromium 핵심만, main에서는 두 브라우저 전체를 실행한다. 전부 통과해야 한다.
- `deploy` 작업의 `Connect to Tailscale`이 통과해야 한다(5단계의 OIDC).

backend 배포는 서버에서 `poker-backend-deploy-<실행>-<시도>` 유닛으로 실행되며, 새 backend가 시작 차단 상태로 뜬 뒤 edge를 거친 정상 확인을 최대 120초 하고, 기록을 남기고 시작을 연다.

**확인:** 작업 요약과 로그에 `DEPLOYED`가 있고 `Deploy frontend`가 실행됐다. 서버에서:

```bash
cd /home/ubuntu/poker-chip-manager
sudo ls .local/deploy/                             # backend-pending, pending이 없어야 한다
sudo cat .local/deploy/backend-current             # revision=병합 커밋
sudo cat .local/deploy/gate/start-gate.json        # "phase":"COMPLETE"
sudo grep '^BACKEND_IMAGE=' .env                   # 자리표시자가 아니라 실제 digest
sudo docker compose exec -T backend curl -fsS http://127.0.0.1:8080/internal/deploy/status
# "startsClosed":false, "activeTournaments":0
```

**되돌리기와 실패 처리:**

- 검사 실패(`restart-e2e` 등): `plan` 이후가 실행되지 않으므로 서버는 그대로다. 원인을 고친 커밋을 main에 병합한다.
- `Connect to Tailscale` 실패: 서버는 그대로다. OIDC 설정을 고친 뒤 Deploy 워크플로를 main에서 수동 실행하고 `ref`에 병합 커밋의 전체 SHA를 넣는다.
- backend 실패: 요약에 종료 코드가 나오고 프런트는 보류된다. 로그에 `RECOVERY_REQUIRED`가 있으면 요약이 알려 주는 실행 디렉터리의 복구 스크립트를 실행한다.

  ```bash
  sudo bash /home/ubuntu/poker-chip-manager/deploy/run-poker-backend-deploy-<실행>-<시도>/recover-backend.sh
  ```

  첫 배포는 되돌릴 이전 이미지가 없으므로 복구는 실패한 backend를 멈추고 `NO_PREVIOUS_IMAGE`로 끝난다. 새 backend가 상태 조회에 답하지 않으면(재시작 반복, 768m 안의 OOM 등) 복구는 게임이 없음을 증명하지 못해 `RECOVERY_REQUIRED`로 멈춘다. 배포가 `releasing` 단계까지 갔다면 시작 차단이 이미 풀렸을 수 있으므로, 직접 멈추기 전에 `sudo grep '^phase=' /home/ubuntu/poker-chip-manager/.local/deploy/backend-pending`으로 단계를 확인한다. `releasing`이 아니면 시작을 연 적이 없어 게임이 있을 수 없다. `releasing`이어도 백엔드가 실패하면 프런트는 보류되어 이전 프런트(온라인 버튼이 꺼진 화면)가 그대로이므로, 화면으로 게임을 만들 수는 없다. 어느 경우든 확인한 뒤에 직접 멈추고 복구를 다시 실행한다.

  ```bash
  cd /home/ubuntu/poker-chip-manager
  sudo docker compose stop backend
  sudo bash deploy/run-poker-backend-deploy-<실행>-<시도>/recover-backend.sh
  ```

  `sudo journalctl -u poker-backend-deploy-<실행>-<시도> --no-pager`와 `sudo docker compose logs --no-color backend`로 원인을 고친 뒤 Deploy 워크플로를 main에서 같은 SHA로 수동 실행한다.
- `HELD`는 첫 배포에서는 나오지 않는다(진행 중 게임이 없다).

## 7. HTTPS·WS 확인

**할 일과 확인:** 서버에서 edge를 거쳐 본다.

```bash
curl -fsS https://pcm.jwlee.xyz/api/health
# {"status":"UP","protocolVersion":...,"version":"<병합 커밋>"}
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://pcm.jwlee.xyz/online/
# 200 text/html
curl -sS --http1.1 -o /dev/null -w '%{http_code}\n' -H 'Origin: https://pcm.jwlee.xyz' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: cG9rZXItZGVwbG95LWNoZWNr' https://pcm.jwlee.xyz/ws
# 401: 세션이 없어서. 403이면 Origin 설정, 200 HTML이면 edge 라우팅 문제
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://pcm.jwlee.xyz/api/no-such-path
# 404 application/json: API 오류에 SPA HTML이 붙지 않는다
curl -sS -o /dev/null -w '%{http_code}\n' https://pcm.jwlee.xyz/internal/deploy/status
# 404
```

브라우저 두 개(또는 기기 두 대)로 `https://pcm.jwlee.xyz/online/`에서 방을 만들고 참가한다. 개발자 도구에서 `__Host-pcm-session` 쿠키가 Secure·HttpOnly인지 본다. 아무 조작 없이 2분 이상 두어도 연결이 유지되는지 본다. 앱의 15초 생존 확인이 edge의 75초 제한 안에서 연결을 살려 둬야 한다(O09). 확인이 끝나면 방에서 나간다.

**되돌리기:** 아래 "전체 되돌리기"를 따른다.

## 8. 프런트 배포 확인

6단계 실행의 `Deploy frontend`가 이미 배포했다.

**확인:**

```bash
sudo cat /home/ubuntu/poker-chip-manager/.local/deploy/current   # revision=병합 커밋
```

`https://pcm.jwlee.xyz/local/`의 앱 홈에서 멀티플레이 버튼이 켜져 있고 `/online/`으로 간다. 5a단계에서 권장안을 적용했다면 `https://54.180.47.226/local/`에서 버튼을 눌렀을 때 `https://pcm.jwlee.xyz/online/`으로 이동하는지도 본다. 그대로 두기로 했다면 IP 주소의 버튼이 오류 화면으로 끝나는 것을 확인하고 기록한다. 단일 기기 모드가 그대로 동작하고, 오프라인 준비 완료 뒤 비행기 모드에서도 열린다.

프런트가 보류됐다면(요약의 `The frontend was held too`) backend를 고친 뒤 Deploy 워크플로를 main에서 병합 커밋으로 수동 실행한다. backend가 이미 배포됐으면 프런트만 남은 차이로 배포된다.

**되돌리기:** 2단계에서 적어 둔 이전 프런트의 `image=`·`revision=`을 그대로 넣어 수동 배포한다. README의 "First manual deployment on EC2"는 `:main` 태그를 읽는데, 그 태그는 이미 병합 커밋의 새 프런트를 가리키므로 쓰지 않는다. 이전 이미지는 서버에 남아 있지만, 정리됐다면 digest로 다시 받는다.

```bash
cd /home/ubuntu/poker-chip-manager
digest='<2단계의 image= 값 전체>'
revision='<2단계의 revision= 값>'
sudo docker image inspect "$digest" > /dev/null 2>&1 || sudo docker pull "$digest"
unit="poker-deploy-rollback-$(date +%s)"
sudo systemd-run --unit="$unit" --service-type=exec --wait --collect \
  /usr/bin/bash /home/ubuntu/poker-chip-manager/deploy/deploy-frontend.sh \
  "$digest" "$revision" https://pcm.jwlee.xyz
sudo journalctl -u "$unit" --no-pager -n 100
sudo cat .local/deploy/current        # revision=2단계의 값
```

`deploy/deploy-frontend.sh`가 서버에 없거나 오래됐으면 저장소의 같은 파일을 먼저 올린다(README의 "Upload from Windows PowerShell"). 다음 main 실행이 다시 새 프런트를 배포하므로, 오래 유지하려면 버튼을 끄는 커밋을 main에 병합한다.

## 9. 실기기 확인

**할 일:** [frontend/DEVICE_CHECKS.md](../frontend/DEVICE_CHECKS.md)의 "운영 서버 공개 확인 (계획 4)" 항목을 실제 운영 주소에서 확인하고, 같은 파일의 "온라인 실기기 확인 대기" 항목도 운영 주소로 다시 본다. 특히 동일 Wi-Fi 9명, iPhone 잠금 뒤 복귀, 설치 앱 안의 `/online/`, 초대 링크, 긴 이름의 복구 알림이다.

**확인:** 결과(기기, OS·브라우저 버전, 날짜, 통과 여부)를 DEVICE_CHECKS.md에 기록한다. 같은 Wi-Fi 9명이 참가·조작하는 동안 `요청이 너무 많습니다` 안내가 나오면 안 된다.

**되돌리기:** 공개를 막을 결함이면 "전체 되돌리기"를 따르고 고친 뒤 6단계부터 다시 진행한다.

## 10. 부하 측정

R4의 메모리 한도(`BACKEND_MEM_LIMIT=768m`, 힙 384m)를 유지할지 판단하는 근거를 만든다. 운영 방 한도가 10개이므로 측정 중에는 실제 사용자가 방을 만들 수 없다. 공개 안내 전에 한다. 도구 설명은 [load/README.md](load/README.md)에 있다.

**할 일:** 먼저 서버의 방이 0개인지 보고, 메모리 기록을 시작한다.

```bash
cd /home/ubuntu/poker-chip-manager
sudo docker compose exec -T backend curl -fsS http://127.0.0.1:8080/internal/deploy/status   # "rooms":0
free -m
id=$(sudo docker compose ps -q backend)
while :; do
  printf '%s %s\n' "$(date +%T)" \
    "$(sudo docker stats --no-stream --format '{{.MemUsage}} {{.MemPerc}} {{.CPUPerc}}' "$id")"
  sleep 10
done | tee "$HOME/load-mem-$(date +%Y%m%d-%H%M).log"
```

PC(Node 24)의 저장소 루트에서 실행한다. 한 주소에서 방 생성 분당 5개, 새 세션 분당 30개 한도 때문에 준비에만 몇 분이 걸리며, 그동안의 429는 `setupWaits`로 따로 센다(R18). 같은 주소에서 다른 사람이 방을 만들면 한도를 나눠 쓴다.

```bash
node deploy/load/load-rooms.mjs --url https://pcm.jwlee.xyz --rooms 10 --players 9 --minutes 10 > load-result.json
```

Git Bash에서 실행한다. Windows PowerShell 5.1의 `>`는 UTF-16으로, `Out-File -Encoding utf8`은 BOM을 붙여 저장하므로 `jq`나 `JSON.parse`가 결과를 읽지 못한다.

끝나면 서버의 기록을 Ctrl+C로 멈추고 다시 본다.

```bash
free -m
sudo docker inspect --format 'restarts={{.RestartCount}} oom={{.State.OOMKilled}}' "$id"
sudo docker compose exec -T backend curl -fsS http://127.0.0.1:8080/internal/deploy/status   # "rooms":0
```

**확인:** `load-result.json`의 `errorCount`가 0이다. 메모리 기록의 최댓값, `restarts`·`oom`, 스왑 사용량을 [TECH_DECISIONS.md](../TECH_DECISIONS.md) T79와 [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md)에 적고 한도 유지 여부를 정한다. 판단 예시: 재시작·OOM이 없고 최댓값이 한도의 80% 아래면 유지, 넘으면 T79대로 인스턴스를 키우고 한도를 다시 정한다. 이 기준은 측정 전 제안이며 사용자가 정한다.

**되돌리기:** 측정 중 Ctrl+C를 한 번 누르면 도구가 방을 정리하고 그때까지의 결과를 출력한다. 한 번 더 눌러 정리 없이 끝냈다면 남은 방은 모든 참가자의 연결이 끊긴 채 30분이 지나면 지워진다. backend가 재시작됐다면 방은 이미 사라졌다.

## 11. 앱 홈 안내 공개

**할 일:** 7~10단계가 모두 통과하면 사용자에게 `https://pcm.jwlee.xyz/local/`의 멀티플레이 버튼을 안내한다. 코드 변경은 없다.

**확인:** 공개 뒤 하루 동안 README의 "Operational checks"로 재시작·OOM·오류·메모리·디스크를 본다. 다음 프런트 단독 배포 때 backend의 `started=` 시각이 바뀌지 않는지 확인한다(O01).

**되돌리기:** 아래 "전체 되돌리기".

## 전체 되돌리기

멀티플레이를 다시 숨겨야 할 때의 순서다.

1. 진행 중 게임을 확인한다: 위의 `/internal/deploy/status`에서 `activeTournaments`. backend를 멈추면 모든 방이 사라진다.
2. 프런트: 8단계의 되돌리기로 이전 프런트를 배포한다. 오래 유지하려면 버튼을 끄는 커밋을 main에 병합한다.
3. 변수: `gh variable set BACKEND_DEPLOY_ENABLED --body false`.
4. backend를 멈추려면 게임이 0개일 때 `sudo docker compose stop backend`. 진행 중 게임이 있으면 끝날 때까지 기다린다.
5. edge·`compose.yaml`·`.env`는 남겨도 프런트에 영향이 없다. 되돌리려면 각 단계의 되돌리기를 역순(5a → 4 → 3 → 2)으로 따른다. backend가 멈춘 뒤에만 한다. `.env`는 백업 전체가 아니라 `BACKEND_` 세 줄만 지운다(2단계). 백업에는 공개 전 `FRONTEND_IMAGE`가 있어 지금 실행 중인 프런트와 어긋난다.

## 수용 시험 기록

DEPLOYMENT_SPEC 8절의 O01~O12는 이 절차를 실행하기 전까지 모두 대기다. 이 절차에서 관찰할 수 있는 것은 다음과 같다. 결과는 IMPLEMENTATION_PROGRESS.md에 적는다.

| ID | 관찰 시점 |
|---|---|
| O01 | 11단계 뒤 첫 프런트 단독 배포 |
| O06 | 6단계의 첫 배포(새 backend는 정상 확인 동안 닫혀 있다) |
| O09 | 7단계의 유휴 연결 |
| O12 | 10단계의 메모리. 이 서버는 ARM64가 아니라 x86_64다 |

O02~O05, O07, O08, O10, O11은 실패·경합 상황을 일부러 만들어야 하므로 이 절차에 포함하지 않는다. 스크립트 모의 시험이 다룬 범위는 README.md의 "Local verification"에 있다.
