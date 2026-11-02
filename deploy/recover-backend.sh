#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu after deploy-backend.sh left backend-pending behind.
# Holding the lock proves the earlier deployment can no longer replace anything.
# Exit codes: 0 nothing to do or recovered, 1 still unresolved, 2 invalid input.
# recover-backend.sh --open-unowned-gate <origin> opens a gate no record explains.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# Actions uploads each run's scripts into deploy/run-<unit>/, one level deeper.
case "$script_dir" in
  */deploy/run-*) project=$(cd -- "$script_dir/../.." && pwd) ;;
  *) project=$(cd -- "$script_dir/.." && pwd) ;;
esac
cd "$project"
mode=${1:-}
origin=''
case "$mode" in
  '') ;;
  --open-unowned-gate)
    origin=${2:-}
    [[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Supply an HTTPS origin without a trailing slash.' >&2; exit 2; } ;;
  *) echo 'Usage: recover-backend.sh [--open-unowned-gate <origin>]' >&2; exit 2 ;;
esac
state="$project/.local/deploy"
pending="$state/backend-pending"
gate_dir="$state/gate"
gate_file="$gate_dir/start-gate.json"
deployment_id=''
# An unreadable gate file boots as "unknown"; recovery alone may open that.
accept_unknown_holder=yes
# shellcheck source=deploy/backend-lib.sh
source "$script_dir/backend-lib.sh"
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock; it was left alone.' >&2; exit 1; }
mkdir -p "$gate_dir"
chmod 0755 "$gate_dir"

# 표시가 없는 상태를 판정하고 명시한 경우에만 주인 없는 게이트를 연다
inspect_without_pending() {
  local running response closed holder active
  running=$(running_image) || { echo 'RECOVERY_REQUIRED: the running backend could not be determined.' >&2; exit 1; }
  if [[ -z "$running" ]]; then
    [[ -z "$mode" ]] || { echo 'No backend is running; there is no gate to open.' >&2; exit 1; }
    echo 'NOTHING_TO_RECOVER: no backend is running.'
    exit 0
  fi
  response=$(read_status) || { echo 'RECOVERY_REQUIRED: the backend status could not be read.' >&2; exit 1; }
  closed=$(plain_field "$response" startsClosed)
  [[ "$closed" == true || "$closed" == false ]] || { echo 'RECOVERY_REQUIRED: the backend status is unclear.' >&2; exit 1; }
  if [[ "$closed" == false ]]; then echo 'NOTHING_TO_RECOVER'; exit 0; fi
  holder=$(string_field "$response" deploymentId)
  active=$(plain_field "$response" activeTournaments)
  if [[ -z "$mode" ]]; then
    echo "UNOWNED_GATE_CLOSED: starts are closed by '$holder' with no pending record ($active active)." >&2
    echo 'Inspect it, then run: deploy/recover-backend.sh --open-unowned-gate <origin>' >&2
    exit 1
  fi
  [[ "$active" == 0 && -n "$holder" ]] || { echo 'The gate stays closed: tournaments are reported as running.' >&2; exit 1; }
  healthy "$running" "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$running")" no \
    || { echo 'The gate stays closed: the backend failed the health check.' >&2; exit 1; }
  deployment_id=$holder
  open_gate || { echo 'RECOVERY_REQUIRED: the gate could not be proved open.' >&2; exit 1; }
  echo "RECOVERED opened-unowned-gate $holder"
  exit 0
}
# 복구 실패를 알리고 표시와 차단을 남긴 채 끝낸다
still_required() {
  echo "RECOVERY_REQUIRED: $1 $pending and the gate were left in place." >&2
  exit 1
}
# 서버가 게이트 파일과 달리 열렸다고 읽히면 기록하지 않고 끝낸다
stop_if_mount_broken() {
  mount_is_broken "$1" || return 0
  echo "GATE_MOUNT_BROKEN: the new backend reads open while $gate_file is closed." >&2
  echo 'It may hold games, so it was neither recorded nor replaced. Fix the gate mount and rerun.' >&2
  exit 1
}
# 배포 기록에 남은 값으로 상태 파일 하나를 되돌린다
restore_record() {
  local image revision
  image=$(pending_field "previous_$2_image")
  revision=$(pending_field "previous_$2_revision")
  if [[ -n "$image" ]]; then
    replace_file "$state/$1" "image=$image
revision=$revision
"
  else
    rm -f -- "$state/$1"
  fi
}

if [[ ! -e "$pending" ]]; then inspect_without_pending; fi
[[ -z "$mode" ]] || { echo "$pending exists; run recovery without --open-unowned-gate." >&2; exit 1; }

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

running=$(running_image) || still_required 'The running backend could not be determined.'

# The target only ran if the replacement phase was reached.
target_ran=no
if [[ ( "$phase" == replacing || "$phase" == releasing ) && -n "$running" && "$running" == "$target_id" ]]; then
  target_ran=yes
  response=$(read_status) || response=''
  stop_if_mount_broken "$response"
fi
if [[ "$target_ran" == yes ]] && healthy "$target_id" "$revision" no; then
  response=$(read_status) || still_required 'The new backend is healthy but its status cannot be read.'
  stop_if_mount_broken "$response"
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
  replace_is_safe || still_required 'NO_PREVIOUS_IMAGE: the backend cannot be proved free of games. Stop it first if that is acceptable.'
  if [[ -n "$running" ]]; then compose stop backend; fi
  rm -- "$pending"
  echo 'NO_PREVIOUS_IMAGE: the failed first deployment was stopped and starts stay closed.' >&2
  exit 1
fi

if [[ -n "$running" && "$running" == "$previous_id" ]]; then
  # This server may be holding games, so it is never replaced by recovery.
  healthy "$previous_id" "$previous_revision" no \
    || still_required 'The previous backend is running but failed the health check. See the README for the manual step.'
else
  replace_is_safe || still_required 'The backend cannot be proved free of games, so it was left running. Stop it first if that is acceptable.'
  # A releasing deployment may already have written COMPLETE, and the restored server must boot closed.
  write_gate PREPARED || still_required 'The gate file could not be written.'
  set_phase rolling-back
  { start_backend "$rollback" && healthy "$previous_id" "$previous_revision" no; } \
    || still_required 'ROLLBACK_FAILED: the previous backend did not pass the health check.'
fi
set_image "$previous_ref"
restore_record backend-current current
restore_record backend-lastHealthy healthy
open_gate || still_required 'The previous backend is healthy but the gate could not be proved open.'
rm -- "$pending"
echo "RECOVERED rolled-back to $previous_ref; the failed deployment did not complete."
