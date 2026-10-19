#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run with sudo on Ubuntu, from a complete checkout containing compose.yaml.
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project"
target=${1:-}
revision=${2:-}
origin=${3:-}
repository=ghcr.io/mannal2/poker-chip-manager-frontend
[[ "$target" == "$repository"@sha256:* && "${target##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'Supply the frontend image by sha256 digest.' >&2; exit 2;
}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Supply the 40-character commit SHA.' >&2; exit 2; }
[[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { echo 'Supply an HTTPS origin without a trailing slash.' >&2; exit 2; }
[[ -f .env && -f compose.yaml ]] || { echo 'Missing .env or compose.yaml.' >&2; exit 2; }

state="$project/.local/deploy"
mkdir -p "$state"
exec 9> "$state/lock"
flock -n 9 || { echo 'Another deployment holds the lock.' >&2; exit 1; }
[[ ! -e "$state/pending" ]] || {
  echo "RECOVERY_REQUIRED: inspect $state/pending before another deployment." >&2; exit 1;
}

compose() { env -u FRONTEND_IMAGE docker compose --project-directory "$project" "$@"; }
available_kb=$(df -Pk "$project" | awk 'END {print $4}')
(( available_kb >= 1048576 )) || { echo 'Less than 1 GiB free; deployment stopped.' >&2; exit 1; }
compose config -q
container=$(compose ps -q frontend)
[[ -n "$container" ]] || { echo 'A running frontend is required for this initial deployment script.' >&2; exit 1; }
previous_id=$(docker inspect --format '{{.Image}}' "$container")
rollback="poker-frontend:rollback-${previous_id#sha256:}"
docker tag "$previous_id" "$rollback"
docker pull "$target"
actual_revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target")
[[ "$actual_revision" == "$revision" ]] || { echo 'Image revision does not match the requested commit.' >&2; exit 1; }
target_id=$(docker image inspect --format '{{.Id}}' "$target")
image_bytes=$(docker image inspect --format '{{.Size}}' "$target")
available_kb=$(df -Pk "$project" | awk 'END {print $4}')
(( available_kb * 1024 >= image_bytes * 2 + 134217728 )) || {
  echo 'Insufficient space to prepare assets; deployment stopped.' >&2; exit 1;
}

manifest() {
  docker run --rm --network none --entrypoint sh "$1" -c \
    'cd /usr/share/nginx/html && find . -type f -exec sha256sum {} \;'
}
manifest "$rollback" > "$state/previous-files"
manifest "$target" > "$state/target-files"
[[ -s "$state/previous-files" && -s "$state/target-files" ]]

# Verify the active image and every published file through HTTPS/edge Nginx.
# DNS is resolved to this VM so this also works with a future domain name.
healthy() {
  local expected_id=$1 files=$2 deadline hash path actual active
  deadline=$(( $(date +%s) + 120 ))
  while :; do
    active=$(compose ps -q frontend) || active=''
    actual=$(docker inspect --format '{{.Image}}' "$active" 2>/dev/null) || actual=''
    if [[ "$actual" == "$expected_id" ]] && check_files "$files"; then return 0; fi
    (( $(date +%s) < deadline )) || return 1
    sleep 2
  done
}
check_files() {
  local hash path actual
  while read -r hash path; do
    path=${path#./}
    curl --fail --silent --show-error --noproxy '*' \
      --connect-timeout 3 --max-time 5 \
      --resolve "${origin#https://}:443:127.0.0.1" \
      --output "$state/response" "$origin/$path" || return 1
    actual=$(sha256sum "$state/response") || return 1
    [[ "${actual%% *}" == "$hash" ]] || return 1
  done < "$1"
}
healthy "$previous_id" "$state/previous-files" || {
  echo 'Current frontend failed the baseline HTTPS check; no replacement attempted.' >&2; exit 1;
}

# The shared volume keeps old hashed URLs available for already-open clients.
# cp -n never overwrites an existing hashed asset. The HTTPS check detects mismatches.
docker volume inspect poker-frontend-assets > /dev/null
docker run --rm --network none --entrypoint sh \
  --mount type=volume,src=poker-frontend-assets,dst=/release-assets \
  "$target" -c 'cp -an /usr/share/nginx/html/assets/. /release-assets/'
cp .env "$state/previous.env"
printf 'previous=%s\ntarget=%s\nrevision=%s\nphase=replacing\n' \
  "$rollback" "$target" "$revision" > "$state/pending.tmp"
mv "$state/pending.tmp" "$state/pending"

activate() {
  local image=$1
  awk '!/^[[:space:]]*(export[[:space:]]+)?FRONTEND_IMAGE[[:space:]]*=/' .env > .env.deploy.tmp || return 1
  printf 'FRONTEND_IMAGE=%s\n' "$image" >> .env.deploy.tmp || return 1
  mv .env.deploy.tmp .env || return 1
  FRONTEND_IMAGE="$image" docker compose --project-directory "$project" \
    up -d --no-build --no-deps --pull never frontend || return 1
}
if activate "$target" && healthy "$target_id" "$state/target-files"; then
  printf 'image=%s\nrevision=%s\n' "$target" "$revision" > "$state/current.tmp"
  mv "$state/current.tmp" "$state/current"
  cp "$state/current" "$state/lastHealthy.tmp"
  mv "$state/lastHealthy.tmp" "$state/lastHealthy"
  rm -- "$state/pending"
  echo "DEPLOYED $target ($revision)"
  exit 0
fi

echo 'Deployment failed; restoring the previous image.' >&2
if activate "$rollback" && healthy "$previous_id" "$state/previous-files"; then
  cp "$state/previous.env" .env.deploy.tmp
  mv .env.deploy.tmp .env
  rm -- "$state/pending"
  echo 'Previous frontend restored. This deployment still failed.' >&2
else
  echo "RECOVERY_REQUIRED: rollback failed. Keep $state/pending and inspect the server." >&2
fi
exit 1
