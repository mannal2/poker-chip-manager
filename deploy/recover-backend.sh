#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu after deploy-backend.sh left backend-pending behind.
# Holding the lock proves the earlier deployment can no longer replace anything.
# Exit codes: 0 nothing to do or recovered, 1 still unresolved.
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project"
state="$project/.local/deploy"
pending="$state/backend-pending"
gate_dir="$state/gate"
gate_file="$gate_dir/start-gate.json"
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock; it was left alone.' >&2; exit 1; }
[[ -e "$pending" ]] || { echo 'NOTHING_TO_RECOVER'; exit 0; }
mkdir -p "$gate_dir"
chmod 0755 "$gate_dir"

# 배포 기록에서 필드 하나를 읽는다
pending_field() { sed -n "s/^$1=//p" "$pending"; }
deployment_id=$(pending_field deploymentId)
phase=$(pending_field phase)
target=$(pending_field target)
target_id=$(pending_field target_id)
revision=$(pending_field revision)
origin=$(pending_field origin)
rollback=$(pending_field previous)
previous_id=$(pending_field previous_id)
previous_ref=$(pending_field previous_ref)
previous_revision=$(pending_field previous_revision)
[[ -n "$deployment_id" && -n "$target" && -n "$origin" ]] || {
  echo "RECOVERY_REQUIRED: $pending is incomplete; inspect the server by hand." >&2; exit 1;
}

# 백엔드 이미지 변수만 지운 환경에서 Compose를 실행한다
compose() { env -u BACKEND_IMAGE docker compose --project-directory "$project" "$@"; }
# 파일 하나를 임시 파일 뒤 mv로 교체한다
replace_file() {
  local destination=$1 content=$2
  printf '%s' "$content" > "$destination.tmp" && mv "$destination.tmp" "$destination"
}
# 게이트 파일을 컨테이너가 읽을 수 있는 권한으로 원자적으로 교체한다
write_gate() {
  local phase=$1 temporary
  temporary=$(mktemp "$gate_dir/.start-gate.XXXXXX") || return 1
  if printf '{"deploymentId":"%s","phase":"%s"}\n' "$deployment_id" "$phase" > "$temporary" \
    && chmod 0644 "$temporary" && mv "$temporary" "$gate_file"; then return 0; fi
  rm -f -- "$temporary"
  return 1
}
# 컨테이너 안에서 내부 배포 경로에 POST한다
internal_post() {
  compose exec -T backend curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "$2" "http://127.0.0.1:8080/internal/deploy/$1" < /dev/null
}
# 컨테이너 안에서 프로세스와 게이트 상태를 읽는다
read_status() {
  compose exec -T backend curl -fsS --max-time 10 http://127.0.0.1:8080/internal/deploy/status < /dev/null
}
# JSON 응답에서 문자열 필드를 꺼낸다
string_field() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" <<< "$1"; }
# JSON 응답에서 불린이나 숫자 필드를 꺼낸다
plain_field() { sed -n "s/.*\"$2\":\([^,}\"]*\).*/\1/p" <<< "$1"; }
# 복구 실패를 알리고 표시와 차단을 남긴 채 끝낸다
still_required() {
  echo "RECOVERY_REQUIRED: $1 $pending and the gate were left in place." >&2
  exit 1
}
# 실행 중인 backend의 이미지 ID를 출력한다
running_image() {
  local active
  active=$(compose ps -q backend) || active=''
  docker inspect --format '{{.Image}}' "$active" 2> /dev/null || true
}
# .env의 BACKEND_IMAGE 줄만 바꾼다
set_image() {
  awk '!/^[[:space:]]*(export[[:space:]]+)?BACKEND_IMAGE[[:space:]]*=/' .env > .env.deploy.tmp || return 1
  printf 'BACKEND_IMAGE=%s\n' "$1" >> .env.deploy.tmp || return 1
  mv .env.deploy.tmp .env
}
# 지정한 이미지로 backend만 교체한다
start_backend() {
  BACKEND_IMAGE="$1" docker compose --project-directory "$project" \
    up -d --no-build --no-deps --pull never backend
}
# edge를 거쳐 API 버전, 프런트 HTML, WS 경로를 한 번 확인한다
check_edge() {
  local expected=$1 host=${origin#https://} health answer
  local -a request=(--silent --show-error --noproxy '*' --connect-timeout 3 --max-time 5
    --resolve "$host:443:127.0.0.1")
  health=$(curl --fail "${request[@]}" "$origin/api/health") || return 1
  [[ "$(string_field "$health" version)" == "$expected" ]] || return 1
  answer=$(curl "${request[@]}" --output /dev/null --write-out '%{http_code} %{content_type}' "$origin/online/") || return 1
  [[ "$answer" == '200 text/html'* ]] || return 1
  # The backend answers 403 without an allowed Origin, and 401 once only the session is missing.
  answer=$(curl "${request[@]}" --http1.1 --output /dev/null --write-out '%{http_code} %{content_type}' \
    -H "Origin: $origin" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: cG9rZXItZGVwbG95LWNoZWNr' "$origin/ws") || return 1
  [[ "$answer" == 401* && "$answer" != *html* ]]
}
# 기대한 이미지가 실행 중이고 edge 확인을 통과할 때까지 최대 120초 기다린다
healthy() {
  local expected_id=$1 expected_revision=$2 deadline
  deadline=$(( $(date +%s) + 120 ))
  while :; do
    if [[ "$(running_image)" == "$expected_id" ]] && check_edge "$expected_revision"; then return 0; fi
    (( $(date +%s) < deadline )) || return 1
    sleep 2
  done
}
# 완료를 기록하고 현재 프로세스의 게이트를 연 뒤 다시 읽어 증명한다
open_gate() {
  local response closed holder
  response=$(read_status) || return 1
  closed=$(plain_field "$response" startsClosed)
  holder=$(string_field "$response" deploymentId)
  # An unreadable gate file boots as "unknown"; nothing else but this deployment may be opened here.
  [[ "$closed" == false || "$holder" == "$deployment_id" || "$holder" == unknown ]] || return 1
  write_gate COMPLETE || return 1
  if [[ "$closed" != false ]]; then
    internal_post release "{\"deploymentId\":\"$holder\",\"processId\":\"$(string_field "$response" processId)\"}" \
      > /dev/null || return 1
  fi
  response=$(read_status) || return 1
  [[ "$(plain_field "$response" startsClosed)" == false ]]
}
# 상태가 읽히고 진행 게임이 있으면 참이다
games_running() {
  local response active
  response=$(read_status) || return 1
  active=$(plain_field "$response" activeTournaments)
  [[ -n "$active" && "$active" != 0 ]]
}
# 배포 기록의 단계만 바꾼다
set_phase() {
  sed "s/^phase=.*/phase=$1/" "$pending" > "$pending.tmp" && mv "$pending.tmp" "$pending"
}

running=$(running_image)

# The target only ran if the replacement phase was reached.
if [[ "$phase" == replacing && -n "$running" && "$running" == "$target_id" ]] \
  && healthy "$target_id" "$revision"; then
  replace_file "$state/backend-current" "image=$target
revision=$revision
"
  replace_file "$state/backend-lastHealthy" "image=$target
revision=$revision
"
  set_image "$target"
  open_gate || still_required 'The new backend is healthy but the gate could not be proved open.'
  rm -- "$pending"
  echo "RECOVERED completed $target ($revision)"
  exit 0
fi

if [[ -z "$rollback" ]]; then
  # A first deployment has nothing to return to. The closed gate file stays for the next attempt.
  ! games_running || still_required 'NO_PREVIOUS_IMAGE: tournaments are running.'
  if [[ -n "$running" ]]; then compose stop backend; fi
  rm -- "$pending"
  echo 'NO_PREVIOUS_IMAGE: the failed first deployment was stopped and starts stay closed.' >&2
  exit 1
fi

if [[ "$running" == "$previous_id" ]]; then
  # This server may be holding games, so it is never replaced by recovery.
  healthy "$previous_id" "$previous_revision" \
    || still_required 'The previous backend is running but failed the health check.'
else
  ! games_running || still_required 'Tournaments are running, so the backend was not replaced.'
  set_phase rolling-back
  start_backend "$rollback" && healthy "$previous_id" "$previous_revision" \
    || still_required 'ROLLBACK_FAILED: the previous backend did not pass the health check.'
fi
set_image "$previous_ref"
open_gate || still_required 'The previous backend is healthy but the gate could not be proved open.'
rm -- "$pending"
echo "RECOVERED rolled-back to $previous_ref; the failed deployment did not complete."
