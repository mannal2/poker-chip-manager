#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu, from a complete checkout containing compose.yaml.
# Exit codes: 0 DEPLOYED, 3 HELD, 1 failure, 2 invalid input. The numbered
# comments follow DEPLOYMENT_SPEC section 4.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Actions uploads each run's scripts into deploy/run-<unit>/, one level deeper.
case "$script_dir" in
  */deploy/run-*) project=$(cd -- "$script_dir/../.." && pwd) ;;
  *) project=$(cd -- "$script_dir/.." && pwd) ;;
esac
cd "$project"
target=${1:-}
revision=${2:-}
origin=${3:-}
deployment_id=${4:-}
[[ "$target" =~ ^ghcr\.io/mannal2/poker-chip-manager-backend@sha256:[a-f0-9]{64}$ ]] || {
  echo 'Supply the backend image by sha256 digest.' >&2; exit 2;
}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Supply the 40-character commit SHA.' >&2; exit 2; }
[[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Supply an HTTPS origin without a trailing slash.' >&2; exit 2; }
[[ "$deployment_id" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo 'Supply a deployment id of up to 128 safe characters.' >&2; exit 2; }
[[ -f .env && -f compose.yaml ]] || { echo 'Missing .env or compose.yaml.' >&2; exit 2; }
for name in BACKEND_IMAGE BACKEND_MEM_LIMIT BACKEND_HEAP; do
  grep -Eq "^[[:space:]]*(export[[:space:]]+)?$name=." .env || { echo "Set $name in .env first." >&2; exit 2; }
done

state="$project/.local/deploy"
pending="$state/backend-pending"
gate_dir="$state/gate"
gate_file="$gate_dir/start-gate.json"
# shellcheck source=deploy/backend-lib.sh
source "$script_dir/backend-lib.sh"

# 1. Take the lock shared with the frontend script and refuse unfinished work.
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock.' >&2; exit 1; }
[[ ! -e "$pending" ]] || {
  echo "RECOVERY_REQUIRED: inspect $pending and run deploy/recover-backend.sh." >&2; exit 1;
}
[[ ! -e "$state/pending" ]] || {
  echo "RECOVERY_REQUIRED: inspect $state/pending, left by a frontend deployment." >&2; exit 1;
}
# Compose refuses a missing bind source, so this precedes every compose call.
mkdir -p "$gate_dir"
chmod 0755 "$gate_dir"

# 복구 필요 상태를 알리고 표시를 남긴 채 끝낸다
recovery_required() {
  echo "RECOVERY_REQUIRED: $1 Keep $pending and run deploy/recover-backend.sh." >&2
  exit 1
}
# 교체 전에 포기한다. 내가 닫은 게이트만 풀고 완료를 되돌린 뒤에 표시를 지운다
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
  if gate_is_mine; then
    write_gate COMPLETE || recovery_required "$reason The closed gate file could not be restored."
  fi
  rm -- "$pending"
  echo "$reason Nothing was replaced." >&2
  exit 1
}
# 교체 직전의 서버가 prepare한 그 프로세스이고 게임이 없는지 다시 확인한다
replacement_allowed() {
  local response active
  if [[ -z "$running_container" ]]; then
    active=$(compose ps -q backend) || return 1
    [[ -z "$active" ]]
    return
  fi
  response=$(read_status) || return 1
  [[ "$(string_field "$response" processId)" == "$process_id" \
    && "$(string_field "$response" deploymentId)" == "$deployment_id" \
    && "$(plain_field "$response" startsClosed)" == true \
    && "$(plain_field "$response" activeTournaments)" == 0 ]]
}
# 상태 파일에서 필드 하나를 읽는다. 파일이 없으면 빈 값이다
record_field() {
  [[ ! -f "$state/$1" ]] || sed -n "s/^$2=//p" "$state/$1"
}
# 복구에 필요한 배포 기록을 처음 남긴다
write_pending() {
  replace_file "$pending" "deploymentId=$deployment_id
phase=preparing
target=$target
target_id=$target_id
revision=$revision
origin=$origin
previous=$rollback
previous_id=$previous_id
previous_ref=$previous_ref
previous_revision=$previous_revision
previous_current_image=$(record_field backend-current image)
previous_current_revision=$(record_field backend-current revision)
previous_healthy_image=$(record_field backend-lastHealthy image)
previous_healthy_revision=$(record_field backend-lastHealthy revision)
"
}

# 2. Finish disk, image and configuration checks before closing anything.
available_kb=$(df -Pk "$project" | awk 'END {print $4}')
(( available_kb >= 1048576 )) || { echo 'Less than 1 GiB free; deployment stopped.' >&2; exit 1; }
compose config -q
running_container=$(compose ps -q backend)
if [[ -n "$running_container" ]]; then
  # With no pending record, a closed backend belongs to nobody here. Leave it for recovery.
  response=$(read_status) || { echo 'The running backend did not answer; nothing was replaced.' >&2; exit 1; }
  [[ "$(plain_field "$response" startsClosed)" == false ]] || {
    echo 'RECOVERY_REQUIRED: starts are closed with no pending record. See deploy/recover-backend.sh --open-unowned-gate.' >&2
    exit 1
  }
fi
docker pull "$target"
actual_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target")
[[ "$actual_revision" == "$revision" ]] || { echo 'Image revision does not match the requested commit.' >&2; exit 1; }
target_id=$(docker image inspect --format '{{.Id}}' "$target")

previous_id=''
previous_ref=''
if [[ -n "$running_container" ]]; then
  previous_id=$(docker inspect --format '{{.Image}}' "$running_container")
  previous_ref=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}BACKEND_IMAGE=//p' .env | tail -n 1 | tr -d "\"'")
  if [[ "$previous_id" == "$target_id" && -f "$state/backend-current" ]] \
    && grep -qx "revision=$revision" "$state/backend-current"; then
    echo "DEPLOYED $target ($revision) was already running."
    exit 0
  fi
elif [[ -f "$state/backend-lastHealthy" ]]; then
  previous_ref=$(sed -n 's/^image=//p' "$state/backend-lastHealthy")
  previous_id=$(docker image inspect --format '{{.Id}}' "$previous_ref" 2> /dev/null) || previous_id=''
fi
rollback=''
previous_revision=''
if [[ -n "$previous_id" ]]; then
  previous_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$previous_id")
  [[ -n "$previous_revision" ]] || { echo 'The previous image has no revision label; deployment stopped.' >&2; exit 1; }
  rollback="poker-backend:rollback-${previous_id#sha256:}"
  docker tag "$previous_id" "$rollback"
fi

# 3. prepare closes new starts atomically on the server, or answers HELD. The
# record and a closed file come first, so no kill or reboot after prepare can
# boot this server open. HELD and abandon put COMPLETE back before the record goes.
write_pending
process_id=''
write_gate PREPARING || abandon 'The gate file could not be written.'
if [[ -n "$running_container" ]]; then
  response=$(internal_post prepare "{\"deploymentId\":\"$deployment_id\"}") || response=''
  process_id=$(string_field "$response" processId)
  case "$(string_field "$response" result)" in
    HELD)
      write_gate COMPLETE || recovery_required 'HELD, but the closed gate file could not be restored.'
      rm -- "$pending"
      echo "HELD $(plain_field "$response" activeTournaments) tournament(s) in progress; nothing was replaced."
      exit 3 ;;
    READY) [[ -n "$process_id" ]] || abandon 'Prepare gave no process id.' ;;
    *) abandon 'Prepare did not succeed.' ;;
  esac
fi

# 4. Persist that prepare succeeded, so the next container boots closed.
write_gate PREPARED || abandon 'The gate file could not be written.'

# 5. Check the live server again; never replace on the old prepare answer alone.
replacement_allowed || recovery_required 'The final check before replacement did not pass; nothing was replaced.'
set_phase replacing || recovery_required 'The replacing phase could not be recorded; nothing was replaced.'

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
response=$(read_status) || response=''
if mount_is_broken "$response"; then
  recovery_required 'GATE_MOUNT_BROKEN: the new backend reads open while the gate file is closed. It was not replaced.'
fi
[[ -n "$rollback" ]] || recovery_required 'NO_PREVIOUS_IMAGE: there is no earlier healthy backend to restore.'
replace_is_safe || recovery_required 'ROLLBACK_FAILED: the backend cannot be proved free of games, so it was left running.'
set_phase rolling-back || recovery_required 'ROLLBACK_FAILED: the phase could not be recorded.'
if start_backend "$rollback" && healthy "$previous_id" "$previous_revision" no; then
  if set_image "$previous_ref" && open_gate; then
    rm -- "$pending"
    echo 'ROLLED_BACK: the previous backend is running. This deployment still failed.' >&2
    exit 1
  fi
  recovery_required 'The previous backend is healthy but the gate could not be proved open.'
fi
recovery_required 'ROLLBACK_FAILED: the previous backend did not pass the health check.'
