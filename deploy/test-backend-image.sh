#!/usr/bin/env bash
set -euo pipefail

# Builds the backend image and checks it, compose.yaml and the edge routing locally. Needs Docker only.
# Git Bash would rewrite the container paths below into Windows paths.
export MSYS_NO_PATHCONV=1
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

host=pcm.jwlee.xyz
revision=0123456789abcdef0123456789abcdef01234567
spoofed=203.0.113.66
suffix="$$-$RANDOM"
image="poker-backend-test:$suffix"
network="poker-test-$suffix"
gate_volume="poker-test-gate-$suffix"
cert_volume="poker-test-certs-$suffix"
containers=()

# 이 실행이 만든 컨테이너, 네트워크, 볼륨, 이미지를 지운다
cleanup() {
  local status=$?
  trap - EXIT
  if ((${#containers[@]} > 0)); then
    docker rm -f "${containers[@]}" > /dev/null 2>&1 || true
  fi
  docker network rm "$network" > /dev/null 2>&1 || true
  docker volume rm -f "$gate_volume" "$cert_volume" > /dev/null 2>&1 || true
  docker image rm -f "$image" > /dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# 실패 이유를 출력하고 끝낸다
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# 통과한 검사를 출력한다
pass() {
  echo "PASS: $*"
}

# 문자열에 기대한 조각이 있는지 확인한다
expect_contains() {
  [[ "$2" == *"$3"* ]] || fail "$1: expected '$3' in: $2"
}

# 문자열에 금지된 조각이 없는지 확인한다
expect_absent() {
  [[ "$2" != *"$3"* ]] || fail "$1: did not expect '$3' in: $2"
}

# compose.yaml의 backend 서비스 정의가 운영 값을 담는지 확인한다
check_compose() {
  local config backend limit swap
  config=$(FRONTEND_IMAGE=frontend:test BACKEND_IMAGE=backend:test BACKEND_MEM_LIMIT=768m BACKEND_HEAP=384m \
    docker compose config) || fail 'compose.yaml does not render'
  backend=$(printf '%s\n' "$config" | awk '/^  backend:/ { on = 1; next } /^  [a-z]/ { on = 0 } on')
  [[ -n "$backend" ]] || fail 'compose.yaml has no backend service'
  for piece in 'image: backend:test' 'platform: linux/amd64' 'restart: unless-stopped' 'poker-edge:' \
    '- poker-backend' 'max-size: 10m' 'max-file: "3"' 'stop_grace_period: 30s' 'target: /run/poker-gate' \
    'read_only: true' 'JAVA_TOOL_OPTIONS: -Xmx384m'; do
    expect_contains 'compose backend' "$backend" "$piece"
  done
  expect_absent 'compose backend' "$backend" 'ports:'
  limit=$(printf '%s\n' "$backend" | sed -n 's/^ *mem_limit: //p')
  swap=$(printf '%s\n' "$backend" | sed -n 's/^ *memswap_limit: //p')
  [[ -n "$limit" && "$limit" == "$swap" ]] || fail "memswap_limit '$swap' must equal mem_limit '$limit'"
  pass 'compose backend: limits, network, mount, logs and no published port'
}

# 운영 메모리 한도로 backend 컨테이너를 띄운다
start_backend() {
  local name=$1
  shift
  containers+=("$name")
  docker run -d --name "$name" --platform linux/amd64 --memory 768m --memory-swap 768m \
    -e JAVA_TOOL_OPTIONS=-Xmx384m -p 127.0.0.1::8080 "$@" "$image" > /dev/null
}

# 컨테이너 안 loopback에서 health가 응답할 때까지 기다린다
wait_healthy() {
  local tries
  for ((tries = 0; tries < 120; tries++)); do
    docker exec "$1" curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8080/api/health 2> /dev/null && return 0
    [[ "$(docker inspect --format '{{.State.Running}}' "$1")" == true ]] || break
    sleep 1
  done
  docker logs --tail 30 "$1" >&2 || true
  fail "$1 did not become healthy"
}

# 컨테이너 안 loopback으로 배포 상태를 읽는다
deploy_status() {
  docker exec "$1" curl -fsS --max-time 5 http://127.0.0.1:8080/internal/deploy/status
}

# 이미지 라벨, 사용자, 헬스, 쿠키, 내부 경로 차단을 확인한다
check_image() {
  local name=$1 label user logs port health headers code status
  label=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  [[ "$label" == "$revision" ]] || fail "revision label is '$label'"
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/amd64 ]] ||
    fail 'image platform is not linux/amd64'
  pass "revision label and platform"

  user=$(docker exec "$name" stat -c %u /proc/1)
  [[ "$user" =~ ^[0-9]+$ && "$user" != 0 ]] || fail "PID 1 runs as uid '$user'"
  pass "PID 1 runs as uid $user"

  logs=$(docker logs "$name" 2>&1)
  expect_contains 'heap option' "$logs" 'Picked up JAVA_TOOL_OPTIONS: -Xmx384m'
  expect_contains 'active profile' "$logs" '"prod"'
  pass 'prod profile and JAVA_TOOL_OPTIONS heap'

  port=$(docker port "$name" 8080/tcp | head -n 1)
  health=$(curl -fsS --noproxy '*' --max-time 5 "http://$port/api/health")
  expect_contains '/api/health' "$health" '"status":"UP"'
  expect_contains '/api/health' "$health" "\"version\":\"$revision\""
  pass '/api/health is 200 on the published port and reports the commit'

  # Only the attributes are printed on failure: the session id stays out of the output.
  headers=$(curl -fsS --noproxy '*' --max-time 5 -i "http://$port/api/session" |
    tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: //p' | sed -E 's/=[^;]*/=<value>/')
  expect_contains 'session cookie' "$headers" '__Host-pcm-session=<value>'
  expect_contains 'session cookie' "$headers" 'Path=/'
  expect_contains 'session cookie' "$headers" 'Secure'
  expect_contains 'session cookie' "$headers" 'HttpOnly'
  expect_absent 'session cookie' "$headers" 'Domain='
  pass 'prod session cookie is __Host- and Secure over plain HTTP'

  status=$(deploy_status "$name") || fail '/internal/deploy/status failed on container loopback'
  code=$(curl -sS --noproxy '*' --max-time 5 -w '%{http_code}' "http://$port/internal/deploy/status")
  [[ "$code" == 404 ]] || fail "/internal/deploy/status answered $code on the published port"
  pass '/internal/deploy/status is 200 on loopback and 404 on the published port'
}

# 마운트가 있으면 열리고, 없거나 미완료 파일이 있으면 닫힌 채 기동하는지 확인한다
check_gate() {
  local open=$1 closed=$2 unfinished=$3 status
  status=$(deploy_status "$open")
  expect_contains 'empty gate mount' "$status" '"startsClosed":false'
  pass 'starts are open with the gate directory mounted and empty'

  docker exec "$closed" test ! -e /run/poker-gate || fail 'the image must not carry /run/poker-gate'
  status=$(deploy_status "$closed")
  expect_contains 'missing gate mount' "$status" '"startsClosed":true'
  pass 'starts are closed without the gate mount'

  status=$(deploy_status "$unfinished")
  expect_contains 'unfinished gate file' "$status" '"startsClosed":true'
  expect_contains 'unfinished gate file' "$status" '"deploymentId":"deploy-test"'
  pass 'a non-root backend reads a root-owned 0644 gate file'
}

# 받은 헤더를 본문으로 돌려주는 가짜 upstream을 띄운다
start_stub() {
  containers+=("$1")
  docker run -d --name "$1" --network "$network" --network-alias poker-backend --network-alias poker-frontend \
    -e STUB_CONFIG="$stub_config" nginx:stable-alpine sh -c \
    'printf %s "$STUB_CONFIG" > /etc/nginx/conf.d/default.conf && exec nginx -g "daemon off;"' > /dev/null
}

# 임시 자체 서명 인증서로 저장소의 edge 설정을 띄우고 문법을 검사한다
start_edge() {
  local name=$1
  docker run --rm --user 0 --entrypoint sh -v "$cert_volume:/etc/letsencrypt" "$image" -c '
    for domain in pcm.jwlee.xyz poker-ip; do
      mkdir -p "/etc/letsencrypt/live/$domain"
      openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$domain" \
        -keyout "/etc/letsencrypt/live/$domain/privkey.pem" \
        -out "/etc/letsencrypt/live/$domain/fullchain.pem" 2> /dev/null
    done'
  containers+=("$name")
  docker create --name "$name" --network "$network" -v "$cert_volume:/etc/letsencrypt:ro" \
    nginx:stable-alpine > /dev/null
  docker cp deploy/edge/nginx/. "$name:/etc/nginx/conf.d/" > /dev/null
  docker start "$name" > /dev/null
  sleep 1
  docker exec "$name" nginx -t > /dev/null 2>&1 || {
    docker logs --tail 20 "$name" >&2 || true
    fail 'nginx -t failed'
  }
  pass 'nginx -t with throwaway certificates'
}

# 같은 네트워크의 클라이언트에서 공개 호스트 이름으로 edge에 요청한다
edge_request() {
  docker exec "$client" curl -sS -k --noproxy '*' --max-time 10 --path-as-is \
    --resolve "$host:443:$edge_ip" "$@"
}

# 전달 대상, 헤더 덮어쓰기, Upgrade 처리, 내부 경로 차단을 확인한다
check_edge_routing() {
  local client_ip body code
  client_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"$network\").IPAddress}}" "$client")

  body=$(edge_request -H "X-Real-IP: $spoofed" -H "X-Forwarded-For: $spoofed" -H 'X-Forwarded-Proto: http' \
    "https://$host/api/health")
  expect_contains '/api/' "$body" 'port=8080'
  expect_contains '/api/' "$body" "real=$client_ip "
  expect_contains '/api/' "$body" "forwarded=$client_ip "
  expect_contains '/api/' "$body" 'proto=https '
  expect_contains '/api/' "$body" "host=$host "
  expect_absent '/api/' "$body" "$spoofed"
  expect_contains '/api/' "$body" 'connection=|'
  pass '/api/ reaches the backend and overwrites client-sent forwarding headers'

  body=$(edge_request -H "X-Real-IP: $spoofed" -H "X-Forwarded-For: $spoofed" -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' "https://$host/ws")
  expect_contains '/ws' "$body" 'port=8080'
  expect_contains '/ws' "$body" "real=$client_ip "
  expect_absent '/ws' "$body" "$spoofed"
  expect_contains '/ws' "$body" 'upgrade=websocket '
  expect_contains '/ws' "$body" 'connection=upgrade|'
  body=$(edge_request "https://$host/ws")
  expect_contains '/ws without Upgrade' "$body" 'connection=close|'
  pass '/ws forwards Upgrade and overwrites client-sent forwarding headers'

  code=$(docker exec "$edge" sh -c 'cat /etc/nginx/conf.d/pcm.conf' | tr -d '\r' |
    awk '/location = \/ws/ { on = 1 } on && /proxy_read_timeout/ { print $2; exit }')
  [[ "$code" == '75s;' ]] || fail "/ws proxy_read_timeout is '$code'"
  pass '/ws proxy_read_timeout is 75s'

  body=$(edge_request "https://$host/")
  expect_contains '/' "$body" 'port=80 '
  pass 'other paths still reach the frontend'

  body=$(edge_request -w '%{http_code}' "https://$host/api/missing")
  [[ "$body" == 'stub-404404' ]] || fail "an API error was rewritten: $body"
  pass 'API errors pass through without an SPA fallback'

  for path in /internal/ /internal/deploy/status /api/../internal/deploy/status /api/%2e%2e/internal/deploy/status; do
    body=$(edge_request -w '%{http_code}' "https://$host$path")
    [[ "$body" == *404 ]] || fail "$path answered: $body"
    expect_absent "$path" "$body" 'port='
  done
  pass '/internal/ is 404 on the public host and reaches no upstream'
}

# upstream을 진짜 backend로 바꿔 Docker DNS 재조회와 실제 응답을 확인한다
check_edge_backend() {
  local backend=$1 body code
  docker rm -f "$stub" > /dev/null
  docker network connect --alias poker-backend "$network" "$backend"
  # The edge resolver caches a name for 10 seconds.
  sleep 11
  body=$(edge_request "https://$host/api/health")
  expect_contains 'edge to backend' "$body" "\"version\":\"$revision\""
  pass 'edge finds a replaced backend through Docker DNS and reports the commit'

  code=$(edge_request -o /dev/null -w '%{http_code}' -H "Origin: https://$host" -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "https://$host/ws")
  [[ "$code" == 401 ]] || fail "/ws without a session answered $code"
  pass '/ws reaches the backend, which answers 401 without a session'

  code=$(edge_request -o /dev/null -w '%{http_code}' "https://$host/internal/deploy/status")
  [[ "$code" == 404 ]] || fail "/internal/deploy/status answered $code through edge"
  pass '/internal/deploy/status is 404 through edge with the real backend behind it'
}

check_compose

docker build -q --platform linux/amd64 --build-arg "REVISION=$revision" -t "$image" -f backend/Dockerfile backend > /dev/null
pass 'image built'

docker pull -q nginx:stable-alpine > /dev/null
docker network create "$network" > /dev/null
docker volume create "$gate_volume" > /dev/null
docker volume create "$cert_volume" > /dev/null

open="poker-test-open-$suffix"
closed="poker-test-closed-$suffix"
unfinished="poker-test-unfinished-$suffix"
stub="poker-test-stub-$suffix"
edge="poker-test-edge-$suffix"
client="poker-test-client-$suffix"

start_backend "$open" --mount "type=volume,src=$gate_volume,dst=/run/poker-gate,readonly"
start_backend "$closed"
docker run --rm --user 0 --entrypoint sh -v "$gate_volume:/gate" "$image" -c \
  'mkdir /gate/unfinished && chmod 0755 /gate/unfinished &&
   printf "{\"deploymentId\":\"deploy-test\",\"phase\":\"PREPARED\"}" > /gate/unfinished/start-gate.json &&
   chmod 0644 /gate/unfinished/start-gate.json'
start_backend "$unfinished" --mount \
  "type=volume,src=$gate_volume,dst=/run/poker-gate,readonly,volume-subpath=unfinished"
wait_healthy "$open"
wait_healthy "$closed"
wait_healthy "$unfinished"

check_image "$open"
check_gate "$open" "$closed" "$unfinished"

stub_config=$(cat << 'NGINX'
server {
    listen 80;
    listen 8080;
    default_type text/plain;

    location = /api/missing {
        return 404 "stub-404";
    }

    location / {
        return 200 "port=$server_port real=$http_x_real_ip forwarded=$http_x_forwarded_for proto=$http_x_forwarded_proto host=$http_host upgrade=$http_upgrade connection=$http_connection|";
    }
}
NGINX
)
containers+=("$client")
docker run -d --name "$client" --network "$network" --entrypoint sleep "$image" 600 > /dev/null
start_stub "$stub"
start_edge "$edge"
edge_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"$network\").IPAddress}}" "$edge")
check_edge_routing
check_edge_backend "$open"

echo 'PASS: backend image, compose and edge checks'
