#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu, from a complete checkout containing compose.yaml.
# Exit codes: 0 DEPLOYED, 3 HELD, 1 failure, 2 invalid input. The numbered
# comments follow DEPLOYMENT_SPEC section 4.
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project"
target=${1:-}
revision=${2:-}
origin=${3:-}
deployment_id=${4:-}
repository=ghcr.io/mannal2/poker-chip-manager-backend
[[ "$target" == "$repository"@sha256:* && "${target##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'Supply the backend image by sha256 digest.' >&2; exit 2;
}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Supply the 40-character commit SHA.' >&2; exit 2; }
[[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Supply an HTTPS origin without a trailing slash.' >&2; exit 2; }
[[ "$deployment_id" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo 'Supply a deployment id of up to 128 safe characters.' >&2; exit 2; }
[[ -f .env && -f compose.yaml ]] || { echo 'Missing .env or compose.yaml.' >&2; exit 2; }
for name in BACKEND_IMAGE BACKEND_MEM_LIMIT BACKEND_HEAP; do
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$name=." .env || { echo "Set $name in .env first." >&2; exit 2; }
done

# 1. Take the lock shared with the frontend script and refuse unfinished work.
state="$project/.local/deploy"
pending="$state/backend-pending"
gate_dir="$state/gate"
gate_file="$gate_dir/start-gate.json"
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock.' >&2; exit 1; }
[[ ! -e "$pending" ]] || {
  echo "RECOVERY_REQUIRED: inspect $pending and run deploy/recover-backend.sh." >&2; exit 1;
}
# Compose refuses a missing bind source, so this precedes every compose call.
mkdir -p "$gate_dir"
chmod 0755 "$gate_dir"

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
# 복구에 필요한 배포 기록을 단계와 함께 남긴다
write_pending() {
  replace_file "$pending" "deploymentId=$deployment_id
phase=$1
target=$target
target_id=${target_id:-}
revision=$revision
origin=$origin
previous=${rollback:-}
previous_id=${previous_id:-}
previous_ref=${previous_ref:-}
previous_revision=${previous_revision:-}
"
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
# 복구 필요 상태를 알리고 표시를 남긴 채 끝낸다
recovery_required() {
  echo "RECOVERY_REQUIRED: $1 Keep $pending and run deploy/recover-backend.sh." >&2
  exit 1
}
# 교체 전에 포기한다. 내가 닫은 게이트는 풀고 다른 배포의 차단은 건드리지 않는다
abandon() {
  local reason=$1 response closed holder
  if [[ -n "$running_container" ]]; then
    response=$(read_status) || recovery_required "$reason The backend did not answer."
    closed=$(plain_field "$response" startsClosed)
    holder=$(string_field "$response" deploymentId)
    if [[ "$closed" == true && "$holder" == "$deployment_id" ]]; then
      internal_post release "{\"deploymentId\":\"$deployment_id\",\"processId\":\"$(string_field "$response" processId)\"}" \
        > /dev/null || recovery_required "$reason The gate could not be released."
      response=$(read_status) || recovery_required "$reason The release could not be confirmed."
      [[ "$(plain_field "$response" startsClosed)" == false ]] \
        || recovery_required "$reason The gate is still closed."
    fi
  fi
  rm -- "$pending"
  echo "$reason Nothing was replaced." >&2
  exit 1
}
# 교체 직전의 서버가 prepare한 그 프로세스이고 게임이 없는지 다시 확인한다
replacement_allowed() {
  local response
  if [[ -z "$running_container" ]]; then
    [[ -z "$(compose ps -q backend)" ]]
    return
  fi
  response=$(read_status) || return 1
  [[ "$(string_field "$response" processId)" == "$process_id" \
    && "$(string_field "$response" deploymentId)" == "$deployment_id" \
    && "$(plain_field "$response" startsClosed)" == true \
    && "$(plain_field "$response" activeTournaments)" == 0 ]]
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
# 새 서버가 내 배포로 닫힌 채 기동했는지 확인한다
gate_held() {
  local response
  response=$(read_status) || return 1
  [[ "$(plain_field "$response" startsClosed)" == true \
    && "$(string_field "$response" deploymentId)" == "$deployment_id" ]]
}
# 기대한 이미지가 실행 중이고 edge 확인을 통과할 때까지 최대 120초 기다린다
healthy() {
  local expected_id=$1 expected_revision=$2 must_hold_gate=$3 deadline active actual
  deadline=$(( $(date +%s) + 120 ))
  while :; do
    active=$(compose ps -q backend) || active=''
    actual=$(docker inspect --format '{{.Image}}' "$active" 2> /dev/null) || actual=''
    if [[ "$actual" == "$expected_id" ]] && check_edge "$expected_revision" \
      && { [[ "$must_hold_gate" == no ]] || gate_held; }; then return 0; fi
    (( $(date +%s) < deadline )) || return 1
    sleep 2
  done
}
# 완료를 기록하고 현재 프로세스의 게이트를 연 뒤 다시 읽어 증명한다
open_gate() {
  local response closed
  response=$(read_status) || return 1
  closed=$(plain_field "$response" startsClosed)
  [[ "$closed" == false || "$(string_field "$response" deploymentId)" == "$deployment_id" ]] || return 1
  write_gate COMPLETE || return 1
  if [[ "$closed" != false ]]; then
    internal_post release "{\"deploymentId\":\"$deployment_id\",\"processId\":\"$(string_field "$response" processId)\"}" \
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

# 2. Finish disk, image and configuration checks before closing anything.
available_kb=$(df -Pk "$project" | awk 'END {print $4}')
(( available_kb >= 1048576 )) || { echo 'Less than 1 GiB free; deployment stopped.' >&2; exit 1; }
compose config -q
running_container=$(compose ps -q backend)
docker pull "$target"
actual_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target")
[[ "$actual_revision" == "$revision" ]] || { echo 'Image revision does not match the requested commit.' >&2; exit 1; }
target_id=$(docker image inspect --format '{{.Id}}' "$target")

previous_id=''
previous_ref=''
if [[ -n "$running_container" ]]; then
  previous_id=$(docker inspect --format '{{.Image}}' "$running_container")
  previous_ref=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}BACKEND_IMAGE=//p' .env | tail -n 1 | tr -d "\"'")
elif [[ -f "$state/backend-lastHealthy" ]]; then
  previous_ref=$(sed -n 's/^image=//p' "$state/backend-lastHealthy")
  previous_id=$(docker image inspect --format '{{.Id}}' "$previous_ref" 2> /dev/null) || previous_id=''
fi
if [[ "$previous_id" == "$target_id" && -f "$state/backend-current" ]] \
  && grep -qx "revision=$revision" "$state/backend-current"; then
  echo "DEPLOYED $target ($revision) was already running."
  exit 0
fi
rollback=''
previous_revision=''
if [[ -n "$previous_id" ]]; then
  previous_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$previous_id")
  [[ -n "$previous_revision" ]] || { echo 'The previous image has no revision label; deployment stopped.' >&2; exit 1; }
  rollback="poker-backend:rollback-${previous_id#sha256:}"
  docker tag "$previous_id" "$rollback"
fi

# 3. prepare closes new starts atomically on the server, or answers HELD.
# The marker comes first: a kill right after prepare must not look like a clean state.
write_pending preparing
process_id=''
if [[ -n "$running_container" ]]; then
  response=$(internal_post prepare "{\"deploymentId\":\"$deployment_id\"}") || response=''
  process_id=$(string_field "$response" processId)
  case "$(string_field "$response" result)" in
    HELD)
      rm -- "$pending"
      echo "HELD $(plain_field "$response" activeTournaments) tournament(s) in progress; nothing was replaced."
      exit 3 ;;
    READY) [[ -n "$process_id" ]] || abandon 'Prepare gave no process id.' ;;
    *) abandon 'Prepare did not succeed.' ;;
  esac
fi

# 4. Persist the closed gate so the next container boots closed.
write_gate PREPARED || abandon 'The gate file could not be written.'

# 5. Check the live server again; never replace on the old prepare answer alone.
replacement_allowed || recovery_required 'The final check before replacement did not pass; nothing was replaced.'
write_pending replacing

# 6. Replace only the backend. It stays closed through the health check.
if set_image "$target" && start_backend "$target" && healthy "$target_id" "$revision" yes; then
  # 7. Record success, then the completion metadata, then release this process.
  if replace_file "$state/backend-current" "image=$target
revision=$revision
" && replace_file "$state/backend-lastHealthy" "image=$target
revision=$revision
" && open_gate; then
    rm -- "$pending"
    echo "DEPLOYED $target ($revision)"
    exit 0
  fi
  recovery_required 'The new backend is healthy but the gate could not be proved open.'
fi

echo 'NEW_IMAGE_FAILED: restoring the previous backend with the gate closed.' >&2
[[ -n "$rollback" ]] || recovery_required 'NO_PREVIOUS_IMAGE: there is no earlier healthy backend to restore.'
! games_running || recovery_required 'ROLLBACK_FAILED: tournaments are running, so the backend was not replaced.'
write_pending rolling-back
if start_backend "$rollback" && healthy "$previous_id" "$previous_revision" no; then
  if set_image "$previous_ref" && open_gate; then
    rm -- "$pending"
    echo 'ROLLED_BACK: the previous backend is running. This deployment still failed.' >&2
    exit 1
  fi
  recovery_required 'The previous backend is healthy but the gate could not be proved open.'
fi
recovery_required 'ROLLBACK_FAILED: the previous backend did not pass the health check.'
