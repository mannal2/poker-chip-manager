#!/usr/bin/env bash
set -euo pipefail

# Runs on the CI runner inside a full clone. A current revision is a commit SHA,
# "absent" when that service was never recorded, or "unknown" when it could not be read.
#   check-revision.sh changed <frontendCurrent> <backendCurrent> <target>
#     prints frontend=true|false and backend=true|false; unprovable means both true.
#   check-revision.sh ancestor <current> <target>
#     prints proceed or skip; exit 1 stops the deployment because it cannot be proved safe.

# 40자 SHA이고 이 저장소에 있는 커밋이면 참이다
known_commit() { [[ "$1" =~ ^[a-f0-9]{40}$ ]] && git cat-file -e "$1^{commit}" 2> /dev/null; }
# 현재 커밋 이후 경로가 바뀌었으면 true, 아니면 false를 출력하고 판별 불가면 실패한다
paths_changed() {
  local current=$1 target=$2 status=0
  shift 2
  known_commit "$current" || return 1
  git diff --quiet "$current" "$target" -- "$@" 2> /dev/null || status=$?
  case "$status" in
    0) echo false ;;
    1) echo true ;;
    *) return 1 ;;
  esac
}

command=${1:-}
case "$command" in
  changed)
    target=${4:-}
    known_commit "$target" || { echo 'The target commit is not in this clone.' >&2; exit 2; }
    frontend=$(paths_changed "${2:-}" "$target" frontend shared) || frontend=''
    backend=$(paths_changed "${3:-}" "$target" backend) || backend=''
    if [[ -z "$frontend" || -z "$backend" ]]; then frontend=true; backend=true; fi
    printf 'frontend=%s\nbackend=%s\n' "$frontend" "$backend"
    ;;
  ancestor)
    current=${2:-}
    target=${3:-}
    known_commit "$target" || { echo 'The target commit is not in this clone.' >&2; exit 1; }
    # Nothing recorded means nothing can be overwritten, as on a first deployment.
    if [[ "$current" == absent ]]; then echo proceed; exit 0; fi
    known_commit "$current" || { echo "Cannot prove history from current revision '$current'." >&2; exit 1; }
    if git merge-base --is-ancestor "$current" "$target"; then echo proceed; exit 0; fi
    if git merge-base --is-ancestor "$target" "$current"; then echo skip; exit 0; fi
    echo "$target and $current have diverged." >&2
    exit 1
    ;;
  *)
    echo 'Usage: check-revision.sh changed|ancestor ...' >&2
    exit 2
    ;;
esac
