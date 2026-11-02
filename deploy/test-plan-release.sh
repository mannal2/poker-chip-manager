#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root. Git runs for real on a throwaway repository; SSH and SCP are simulated.
root=$PWD
mkdir -p .local
fixture=$(mktemp -d "$PWD/.local/plan-release-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT
failures=0

# 어긋난 사례를 기록한다
fail() { echo "FAIL $1"; failures=$((failures + 1)); }
# 판정 결과가 기대와 같은지 확인한다
plan_is() {
  local expected=$1 actual
  shift
  actual=$(bash deploy/plan-release.sh "$@" 2>&1) || actual="exit $?"
  [[ "$actual" == "frontend=$expected" ]] || fail "plan $* gave '$actual', expected frontend=$expected"
}
# 잘못된 입력이 입력 오류로 끝나는지 확인한다
plan_refuses() {
  local status=0
  bash deploy/plan-release.sh "$@" > /dev/null 2>&1 || status=$?
  [[ "$status" == 2 ]] || fail "plan $* exited $status, expected 2"
}

# 변경 조합 표 전체를 검사한다
test_plan_table() {
  local result
  for result in deployed skipped; do plan_is deploy true true "$result"; done
  for result in held failed; do plan_is hold true true "$result"; done
  for result in deployed held failed skipped; do
    plan_is deploy false true "$result"
    plan_is skip true false "$result"
    plan_is skip false false "$result"
  done
  plan_refuses
  plan_refuses true true
  plan_refuses maybe true deployed
  plan_refuses true maybe deployed
  plan_refuses true true ''
  plan_refuses true true unknown
}

# 임시 저장소에 커밋을 만들고 SHA를 출력한다
commit_file() {
  mkdir -p "$(dirname "$1")"
  echo "$2" >> "$1"
  git add -A
  git -c user.name=test -c user.email=test@example.com commit -q -m "$2"
  git rev-parse HEAD
}
# 변경 판별 결과가 기대와 같은지 확인한다
changed_is() {
  local expected=$1 actual
  shift
  actual=$(bash "$root/deploy/check-revision.sh" changed "$@" 2>&1 | tr '\n' ' ')
  [[ "$actual" == "$expected " ]] || fail "changed $* gave '$actual', expected '$expected'"
}
# 조상 판정 결과가 기대와 같은지 확인한다
ancestor_is() {
  local expected=$1 actual status=0
  shift
  actual=$(bash "$root/deploy/check-revision.sh" ancestor "$@" 2> /dev/null) || status=$?
  [[ "$status" == 0 ]] || actual="exit $status"
  [[ "$actual" == "$expected" ]] || fail "ancestor $* gave '$actual', expected '$expected'"
}

# 실제 git 이력으로 변경 판별과 조상 판정을 검사한다
test_revisions() {
  local base frontend backend docs side both='frontend=true backend=true'
  mkdir "$fixture/repo"
  cd "$fixture/repo"
  git init -q .
  git config core.autocrlf false
  base=$(commit_file README.md base)
  frontend=$(commit_file frontend/a.ts frontend)
  backend=$(commit_file backend/a.java backend)
  docs=$(commit_file deploy/note.txt docs)
  git checkout -q -b side "$base"
  side=$(commit_file shared/b.json side)
  changed_is 'frontend=true backend=false' "$base" "$base" "$frontend"
  changed_is 'frontend=false backend=true' "$frontend" "$frontend" "$backend"
  changed_is 'frontend=false backend=false' "$backend" "$backend" "$docs"
  changed_is 'frontend=true backend=false' "$base" "$base" "$side"
  changed_is "$both" absent "$backend" "$docs"
  changed_is "$both" "$backend" absent "$docs"
  changed_is "$both" unknown unknown "$docs"
  changed_is "$both" "$(printf 'f%.0s' {1..40})" "$backend" "$docs"
  ancestor_is proceed "$base" "$docs"
  ancestor_is proceed "$docs" "$docs"
  ancestor_is proceed absent "$docs"
  ancestor_is skip "$docs" "$base"
  ancestor_is 'exit 1' "$docs" "$side"
  ancestor_is 'exit 1' unknown "$docs"
  ancestor_is 'exit 1' '' "$docs"
  ancestor_is 'exit 1' "$(printf 'f%.0s' {1..40})" "$docs"
  ancestor_is 'exit 1' "$docs" "$(printf 'f%.0s' {1..40})"
  cd "$root"
}

# 서버 접속을 흉내 내는 ssh와 scp를 만든다
write_remote_mocks() {
  mkdir -p "$fixture/bin"
  cat > "$fixture/bin/ssh" <<'MOCK'
#!/usr/bin/env bash
echo "ssh $*" >> "$MOCK_DIR/calls"
cat >> "$MOCK_DIR/remote-scripts"
case "$*" in
  *'mkdir -p'*) exit 0 ;;
  *'sudo -n bash -s'*) printf '%b' "${MOCK_REVISIONS:-}"; exit "${MOCK_READ_STATUS:-0}" ;;
esac
exit "${MOCK_RUN_STATUS:-0}"
MOCK
  cat > "$fixture/bin/scp" <<'MOCK'
#!/usr/bin/env bash
echo "scp $*" >> "$MOCK_DIR/calls"
exit "${MOCK_SCP_STATUS:-0}"
MOCK
  chmod +x "$fixture/bin/ssh" "$fixture/bin/scp"
}
# 모의 서버 환경으로 release-remote.sh를 실행한다
remote() {
  : > "$fixture/calls"
  : > "$fixture/remote-scripts"
  : > "$fixture/github-output"
  : > "$fixture/summary"
  remote_status=0
  remote_output=$(env MOCK_DIR="$fixture" PATH="$fixture/bin:$PATH" RUNNER_TEMP="$fixture/runner" \
    GITHUB_OUTPUT="$fixture/github-output" GITHUB_STEP_SUMMARY="$fixture/summary" \
    GITHUB_RUN_ID=77 GITHUB_RUN_ATTEMPT=2 GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=o/r \
    DEPLOY_HOST=host.test DEPLOY_USER=ubuntu DEPLOY_SSH_KEY=secret-key-text DEPLOY_HOST_KEY='ssh-ed25519 AAAA' \
    "${remote_env[@]}" bash deploy/release-remote.sh "$@" 2>&1 < /dev/null) || remote_status=$?
}
# 조건이 어긋나면 사례 이름을 기록한다
expect() { "${@:2}" || fail "$1"; }
# 파일에 내용이 없음을 확인한다
lacks() { ! grep -q -- "$1" "$2"; }

# 서버 기록 읽기가 없음과 읽기 실패를 구분하는지 검사한다
test_read_revisions() {
  local sha unknown=$'frontend_current=unknown\nbackend_current=unknown'
  sha=$(printf 'a%.0s' {1..40})
  remote_env=("MOCK_REVISIONS=frontend_current=$sha\nbackend_current=absent\n")
  remote read-revisions
  expect 'read gives revisions' [ "$remote_output" = "frontend_current=$sha"$'\n'"backend_current=absent" ]
  remote_env=(MOCK_READ_STATUS=255)
  remote read-revisions
  expect 'failed read succeeds' [ "$remote_status" = 0 ]
  expect 'failed read is unknown' [ "$remote_output" = "$unknown" ]
  remote_env=('MOCK_REVISIONS=frontend_current=$(evil)\nbackend_current=absent\n')
  remote read-revisions
  expect 'malformed read is unknown' [ "$remote_output" = "$unknown" ]
}
# 원격 종료 코드가 작업 결과로 옮겨지는지 검사한다
test_backend_results() {
  local image revision run_dir
  image="ghcr.io/mannal2/poker-chip-manager-backend@sha256:$(printf 'a%.0s' {1..64})"
  revision=$(printf 'b%.0s' {1..40})
  run_dir=/home/ubuntu/poker-chip-manager/deploy/run-poker-backend-deploy-77-2

  remote_env=()
  remote backend "$image" "$revision"
  expect 'deployed exit' [ "$remote_status" = 0 ]
  expect 'deployed output' grep -qx 'backend=deployed' "$fixture/github-output"
  expect 'run directory made first' grep -q "^ssh .*mkdir -p -- $run_dir" "$fixture/calls"
  expect 'all scripts uploaded together' grep -q "^scp .*deploy/deploy-backend.sh deploy/recover-backend.sh deploy/backend-lib.sh ubuntu@host.test:$run_dir/" "$fixture/calls"
  expect 'deployment id passed' grep -q "'77-2' 'poker-backend-deploy-77-2'" "$fixture/calls"
  expect 'runs in a transient unit' grep -q 'sudo -n systemd-run --unit="$unit" --service-type=exec --wait --collect' "$fixture/remote-scripts"
  expect 'key stays off the command line' lacks secret-key-text "$fixture/calls"

  remote_env=(MOCK_RUN_STATUS=3)
  remote backend "$image" "$revision"
  expect 'held succeeds' [ "$remote_status" = 0 ]
  expect 'held output' grep -qx 'backend=held' "$fixture/github-output"
  expect 'held explains the rerun' grep -q "actions/workflows/deploy.yml.*$revision" "$fixture/summary"

  remote_env=(MOCK_RUN_STATUS=1)
  remote backend "$image" "$revision"
  expect 'failed exit' [ "$remote_status" = 1 ]
  expect 'failed output' grep -qx 'backend=failed' "$fixture/github-output"
  expect 'failed names recovery' grep -q "$run_dir/recover-backend.sh" "$fixture/summary"

  remote_env=(MOCK_RUN_STATUS=255)
  remote backend "$image" "$revision"
  expect 'dropped connection is not held' grep -qx 'backend=failed' "$fixture/github-output"

  remote_env=(MOCK_SCP_STATUS=1)
  remote backend "$image" "$revision"
  expect 'failed upload fails' [ "$remote_status" = 1 ]
  expect 'failed upload output' grep -qx 'backend=failed' "$fixture/github-output"
  expect 'failed upload runs nothing' lacks systemd-run "$fixture/remote-scripts"

  remote_env=()
  remote backend ghcr.io/mannal2/poker-chip-manager-backend:main "$revision"
  expect 'tag refused' [ "$remote_status" != 0 ]
  expect 'tag touches nothing' [ ! -s "$fixture/calls" ]
}
# 프런트 배포가 기존과 같은 위치로 올라가고 실패를 전달하는지 검사한다
test_frontend_run() {
  local image revision
  image="ghcr.io/mannal2/poker-chip-manager-frontend@sha256:$(printf 'a%.0s' {1..64})"
  revision=$(printf 'b%.0s' {1..40})
  remote_env=()
  remote frontend "$image" "$revision"
  expect 'frontend exit' [ "$remote_status" = 0 ]
  expect 'frontend upload name' grep -q 'deploy/deploy-frontend.sh ubuntu@host.test:/home/ubuntu/poker-chip-manager/deploy/deploy-frontend-poker-deploy-77-2.sh' "$fixture/calls"
  remote_env=(MOCK_RUN_STATUS=1)
  remote frontend "$image" "$revision"
  expect 'frontend failure propagates' [ "$remote_status" = 1 ]
}

test_plan_table
test_revisions
write_remote_mocks
test_read_revisions
test_backend_results
test_frontend_run
[[ "$failures" == 0 ]] || { echo "$failures failure(s)"; exit 1; }
echo 'PASS plan-release'
