#!/usr/bin/env bash
set -euo pipefail

# Runs on the CI runner from the repository root, after Tailscale connects. Secrets
# come from the environment and never reach a command line.
#   release-remote.sh read-revisions           prints frontend_current= and backend_current=
#   release-remote.sh backend <image> <sha>    0 deployed or held, 1 failed; writes backend=
#   release-remote.sh frontend <image> <sha>   exits with the deployment's result
: "${DEPLOY_HOST:?DEPLOY_HOST is missing}"
: "${DEPLOY_USER:?DEPLOY_USER is missing}"
: "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY is missing}"
: "${DEPLOY_HOST_KEY:?DEPLOY_HOST_KEY is missing}"

project=/home/ubuntu/poker-chip-manager
origin=https://pcm.jwlee.xyz
remote="$DEPLOY_USER@$DEPLOY_HOST"

umask 077
mkdir -p "$RUNNER_TEMP/poker-ssh"
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$RUNNER_TEMP/poker-ssh/id_ed25519"
printf '%s\n' "$DEPLOY_HOST_KEY" | awk '{print "poker-server " $1 " " $2}' \
  > "$RUNNER_TEMP/poker-ssh/known_hosts"
ssh_options=(
  -i "$RUNNER_TEMP/poker-ssh/id_ed25519"
  -o UserKnownHostsFile="$RUNNER_TEMP/poker-ssh/known_hosts"
  -o HostKeyAlias=poker-server
  -o StrictHostKeyChecking=yes
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
)

# 서버에 기록된 서비스별 배포 커밋을 출력한다. 읽지 못하면 unknown이다
read_revisions() {
  local output='' pattern
  output=$(ssh "${ssh_options[@]}" "$remote" sudo -n bash -s -- "$project/.local/deploy" 2> /dev/null <<'REMOTE'
for pair in frontend:current backend:backend-current; do
  file=$1/${pair#*:}
  if [[ -e $file ]]; then value=$(sed -n 's/^revision=//p' "$file"); else value=absent; fi
  printf '%s_current=%s\n' "${pair%%:*}" "${value:-unknown}"
done
REMOTE
  ) || output=''
  pattern='(absent|unknown|[a-f0-9]{40})'
  if [[ "$output" =~ ^frontend_current=$pattern$'\n'backend_current=$pattern$ ]]; then
    printf '%s\n' "$output"
  else
    printf 'frontend_current=unknown\nbackend_current=unknown\n'
  fi
}

# 입력한 이미지와 커밋의 형식을 확인한다
require_target() {
  local repository=$1 image=$2 revision=$3
  [[ "$image" == "$repository"@sha256:* && "${image##*@sha256:}" =~ ^[a-f0-9]{64}$ ]]
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]]
  [[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
}

# 실행별 디렉터리에 백엔드 스크립트를 올리고 끊겨도 계속되는 유닛으로 실행한다
run_backend() {
  local image=$1 revision=$2 deployment_id=$3 unit=$4 run_dir=$5
  ssh "${ssh_options[@]}" "$remote" mkdir -p -- "$run_dir" < /dev/null || return 1
  scp "${ssh_options[@]}" deploy/deploy-backend.sh deploy/recover-backend.sh deploy/backend-lib.sh \
    "$remote:$run_dir/" || return 1
  ssh "${ssh_options[@]}" "$remote" \
    "bash -s -- '$run_dir' '$image' '$revision' '$origin' '$deployment_id' '$unit'" <<'REMOTE'
set -euo pipefail
run_dir=$1
image=$2
revision=$3
origin=$4
deployment_id=$5
unit=$6
for script in deploy-backend.sh recover-backend.sh backend-lib.sh; do bash -n "$run_dir/$script"; done
result=0
sudo -n systemd-run --unit="$unit" --service-type=exec --wait --collect \
  /usr/bin/bash "$run_dir/deploy-backend.sh" "$image" "$revision" "$origin" "$deployment_id" || result=$?
sudo -n journalctl -u "$unit" --no-pager -n 200 || true
exit "$result"
REMOTE
}

# 백엔드를 배포하고 결과를 작업 출력과 요약에 남긴다. HELD는 실패가 아니다
deploy_backend() {
  local image=$1 revision=$2 deployment_id unit run_dir status=0
  require_target ghcr.io/mannal2/poker-chip-manager-backend "$image" "$revision"
  deployment_id="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  unit="poker-backend-deploy-$deployment_id"
  run_dir="$project/deploy/run-$unit"
  bash -n deploy/deploy-backend.sh
  bash -n deploy/recover-backend.sh
  bash -n deploy/backend-lib.sh
  run_backend "$image" "$revision" "$deployment_id" "$unit" "$run_dir" || status=$?
  case "$status" in
    0)
      echo 'backend=deployed' >> "$GITHUB_OUTPUT" ;;
    3)
      echo 'backend=held' >> "$GITHUB_OUTPUT"
      {
        echo '## Backend deployment held'
        echo
        echo "A tournament is in progress, so \`$revision\` was not deployed and nothing was replaced."
        echo
        echo "When the games end, open [the Deploy workflow]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/workflows/deploy.yml), choose Run workflow, and enter \`$revision\` as \`ref\`."
      } >> "$GITHUB_STEP_SUMMARY" ;;
    *)
      echo 'backend=failed' >> "$GITHUB_OUTPUT"
      {
        echo '## Backend deployment failed'
        echo
        echo "Exit code $status. If the log says \`RECOVERY_REQUIRED\`, run \`sudo bash $run_dir/recover-backend.sh\` on the server."
      } >> "$GITHUB_STEP_SUMMARY"
      return 1 ;;
  esac
}

# 프런트 배포 스크립트를 실행별 이름으로 올리고 실행한다
deploy_frontend() {
  local image=$1 revision=$2 unit
  require_target ghcr.io/mannal2/poker-chip-manager-frontend "$image" "$revision"
  unit="poker-deploy-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  bash -n deploy/deploy-frontend.sh
  scp "${ssh_options[@]}" deploy/deploy-frontend.sh \
    "$remote:$project/deploy/deploy-frontend-$unit.sh"
  ssh "${ssh_options[@]}" "$remote" \
    "bash -s -- '$image' '$revision' '$unit' '$project' '$origin'" <<'REMOTE'
set -euo pipefail
image=$1
revision=$2
unit=$3
project=$4
origin=$5
script="$project/deploy/deploy-frontend-$unit.sh"
bash -n "$script"
result=0
sudo -n systemd-run --unit="$unit" --service-type=exec --wait --collect \
  /usr/bin/bash "$script" "$image" "$revision" "$origin" || result=$?
sudo -n journalctl -u "$unit" --no-pager -n 200 || true
exit "$result"
REMOTE
}

command=${1:-}
case "$command" in
  read-revisions) read_revisions ;;
  backend) deploy_backend "${2:-}" "${3:-}" ;;
  frontend) deploy_frontend "${2:-}" "${3:-}" ;;
  *) echo 'Usage: release-remote.sh read-revisions|backend|frontend ...' >&2; exit 2 ;;
esac
