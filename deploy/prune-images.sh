#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu. Protection is recalculated under the deployment lock,
# so a deployment cannot gain an image between the check and the removal.
# Removal is never forced: Docker refuses an image that a container still uses.
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project"
state="$project/.local/deploy"
keep_recent=5
backend_repository=ghcr.io/mannal2/poker-chip-manager-backend
frontend_repository=ghcr.io/mannal2/poker-chip-manager-frontend
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock.' >&2; exit 1; }

# 이미지 변수를 지운 환경에서 Compose를 실행한다
compose() { env -u BACKEND_IMAGE -u FRONTEND_IMAGE docker compose --project-directory "$project" "$@"; }
# 저장소와 태그가 이 프로젝트 소유일 때 서비스 이름을 출력한다
service_of() {
  case "$1" in
    "$backend_repository") echo backend ;;
    "$frontend_repository") echo frontend ;;
    poker-backend) [[ "$2" != rollback-* ]] || echo backend ;;
    poker-frontend) [[ "$2" != rollback-* ]] || echo frontend ;;
  esac
}
# 상태 파일과 .env가 가리키는 이미지 참조를 모두 출력한다
referenced_images() {
  local file
  for file in backend-current backend-lastHealthy backend-pending current lastHealthy pending; do
    [[ ! -f "$state/$file" ]] || sed -n 's/^\(image\|target\|previous\)=\(.\{1,\}\)$/\2/p' "$state/$file"
  done
  sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}\(BACKEND\|FRONTEND\)_IMAGE=//p' .env | tr -d "\"'"
}

# A failure in either listing stops here, before anything is removed.
containers=$(compose ps -aq)
listing=$(docker image ls --no-trunc --digests --format '{{.ID}} {{.Repository}} {{.Tag}} {{.Digest}}')

declare -A protected=() recent=()
for container in $containers; do
  protected["$(docker inspect --format '{{.Image}}' "$container")"]=1
done
references=$(referenced_images)
for reference in $references; do
  id=$(docker image inspect --format '{{.Id}}' "$reference" 2> /dev/null) || continue
  protected["$id"]=1
done

declare -A refs=() owner=()
while read -r id repository tag digest; do
  service=$(service_of "$repository" "$tag")
  [[ -n "$service" ]] || continue
  owner["$id"]=$service
  [[ "$tag" == '<none>' ]] || refs["$id"]+=" $repository:$tag"
  [[ "$digest" == '<none>' ]] || refs["$id"]+=" $repository@$digest"
done <<< "$listing"

for service in backend frontend; do
  ranked=''
  for id in "${!owner[@]}"; do
    [[ "${owner[$id]}" == "$service" && -z "${protected[$id]:-}" ]] || continue
    ranked+="$(docker image inspect --format '{{.Created}}' "$id") $id"$'\n'
  done
  newest=$(printf '%s' "$ranked" | sort -r | head -n "$keep_recent" | cut -d' ' -f2)
  for id in $newest; do recent["$id"]=1; done
done

for id in "${!owner[@]}"; do
  [[ -z "${protected[$id]:-}" && -z "${recent[$id]:-}" ]] || continue
  # Each name goes separately: a shared image keeps any other project's tag.
  for reference in ${refs[$id]:-}; do
    docker image rm "$reference" || echo "Kept $reference: Docker refused to remove it." >&2
  done
done
echo 'PRUNED'
