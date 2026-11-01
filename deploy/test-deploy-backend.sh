#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root. Docker, HTTPS, time and locks are simulated; no server is touched.
real_flock=$(command -v flock || true)
export REAL_MV REAL_FLOCK=''
REAL_MV=$(command -v mv)
mkdir -p .local
fixture=$(mktemp -d "$PWD/.local/deploy-backend-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/deploy" "$fixture/bin"
cp deploy/deploy-backend.sh deploy/recover-backend.sh deploy/prune-images.sh "$fixture/deploy/"
touch "$fixture/compose.yaml"
export MOCK_DIR="$fixture" PATH="$fixture/bin:$PATH"
state="$fixture/.local/deploy"
gate_file="$state/gate/start-gate.json"
repository=ghcr.io/mannal2/poker-chip-manager-backend
old_image="$repository@sha256:$(printf '0%.0s' {1..64})"
target="$repository@sha256:$(printf 'a%.0s' {1..64})"
revision=$(printf 'b%.0s' {1..40})
old_revision=$(printf 'c%.0s' {1..40})
origin=https://pcm.jwlee.xyz
export OLD_REVISION=$old_revision NEW_REVISION=$revision

cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$MOCK_DIR/calls"
# 스크립트 본체를 강제 종료한다
die_now() { kill -9 "$(cat "$MOCK_DIR/script.pid")"; exit 137; }
# 게이트 파일을 읽어 새 프로세스의 게이트를 정한다
boot() {
  echo $(( $(cat "$MOCK_DIR/proc") + 1 )) > "$MOCK_DIR/proc"
  local file="$MOCK_DIR/.local/deploy/gate/start-gate.json"
  if [[ ! -f $file ]] || grep -q '"phase":"COMPLETE"' "$file"; then : > "$MOCK_DIR/holder"
  else sed -n 's/.*"deploymentId":"\([^"]*\)".*/\1/p' "$file" > "$MOCK_DIR/holder"; fi
}
# 모의 프로세스의 상태 응답을 출력한다
status() {
  local holder process id
  holder=$(cat "$MOCK_DIR/holder"); process=process-$(cat "$MOCK_DIR/proc"); id=null
  [[ -z $holder ]] || id="\"$holder\""
  [[ ${SCENARIO:-} != recheck-mismatch ]] || process=restarted
  [[ -n $holder ]] && closed=true || closed=false
  printf '{"processId":"%s","startsClosed":%s,"deploymentId":%s,"activeTournaments":%s,"rooms":3}\n' \
    "$process" "$closed" "$id" "$(cat "$MOCK_DIR/active")"
}
# 내부 배포 경로를 흉내 낸다
internal() {
  local url=${*: -1} body='' previous=''
  for arg in "$@"; do
    [[ $previous != -d ]] || body=$arg
    previous=$arg
  done
  echo "$url $body" >> "$MOCK_DIR/internal"
  local id
  id=$(sed -n 's/.*"deploymentId":"\([^"]*\)".*/\1/p' <<< "$body")
  case "$url" in
    */prepare)
      case "${SCENARIO:-}" in
        prepare-held)
          printf '{"result":"HELD","processId":"process-%s","activeTournaments":2}\n' "$(cat "$MOCK_DIR/proc")"
          return ;;
        prepare-conflict) echo other-deployment > "$MOCK_DIR/holder"; exit 22 ;;
        prepare-lost) echo "$id" > "$MOCK_DIR/holder"; exit 22 ;;
      esac
      echo "$id" > "$MOCK_DIR/holder"
      [[ ${SCENARIO:-} != kill-after-prepare ]] || die_now
      printf '{"result":"READY","processId":"process-%s","activeTournaments":0}\n' "$(cat "$MOCK_DIR/proc")" ;;
    */status)
      [[ ${SCENARIO:-} != kill-after-gate ]] || die_now
      [[ ${SCENARIO:-} != status-failure ]] || exit 7
      status ;;
    */release)
      [[ ${SCENARIO:-} != release-failure ]] || exit 22
      local holder
      holder=$(cat "$MOCK_DIR/holder")
      if [[ -n $holder ]]; then
        [[ $holder == "$id" && $body == *"\"processId\":\"process-$(cat "$MOCK_DIR/proc")\""* ]] || exit 22
      fi
      [[ ${SCENARIO:-} == release-lies ]] || : > "$MOCK_DIR/holder"
      echo '{"result":"RELEASED"}' ;;
  esac
}
# 프로젝트 이미지 정리용 이미지 표에서 열 하나를 찾는다
image_field() { awk -v r="$1" -v c="$2" '$2"@"$4==r || $2":"$3==r || $1==r {print $c; exit}' "$MOCK_DIR/images"; }
case "$1" in
  pull) [[ ${SCENARIO:-} != pull-failure ]] ;;
  tag) : ;;
  inspect)
    if [[ -f $MOCK_DIR/images ]]; then echo sha256:running; exit; fi
    case "$(cat "$MOCK_DIR/running")" in new) echo new-id ;; old) echo old-id ;; *) exit 1 ;; esac ;;
  image)
    ref=${*: -1}
    if [[ $2 == ls ]]; then awk '{print $1, $2, $3, $4}' "$MOCK_DIR/images"
    elif [[ $2 == rm ]]; then
      [[ -f $MOCK_DIR/images ]] || exit 1
      echo "$ref" >> "$MOCK_DIR/removed"
      awk -v r="$ref" '!($2"@"$4==r || $2":"$3==r)' "$MOCK_DIR/images" > "$MOCK_DIR/images.next"
      "$REAL_MV" "$MOCK_DIR/images.next" "$MOCK_DIR/images"
    elif [[ -f $MOCK_DIR/images ]]; then
      [[ -n $(image_field "$ref" 1) ]]
      if [[ "$*" == *Created* ]]; then image_field "$ref" 5; else image_field "$ref" 1; fi
    else
      new=false
      [[ $ref != *aaaaaaaa* ]] || new=true
      if [[ "$*" == *org.opencontainers.image.revision* ]]; then
        if [[ $new == false ]]; then echo "$OLD_REVISION"
        elif [[ ${SCENARIO:-} == wrong-revision ]]; then echo wrong
        else echo "$NEW_REVISION"; fi
      elif [[ "$*" == *Size* ]]; then echo 1000
      elif [[ $new == true ]]; then echo new-id
      else echo old-id; fi
    fi ;;
  compose)
    shift 3
    case "$1" in
      ps)
        [[ $(cat "$MOCK_DIR/running") == none ]] || echo container-id ;;
      exec) internal "$@" ;;
      stop) echo none > "$MOCK_DIR/running" ;;
      up)
        if [[ $BACKEND_IMAGE == poker-backend:rollback-* ]]; then
          [[ ${SCENARIO:-} != rollback-start-failure ]] || exit 1
          echo old > "$MOCK_DIR/running"
        else
          [[ ${SCENARIO:-} != replace-failure ]] || exit 1
          echo new > "$MOCK_DIR/running"
        fi
        [[ ${SCENARIO:-} == broken-mount ]] && : > "$MOCK_DIR/holder" || boot
        [[ ${SCENARIO:-} != kill-after-up ]] || die_now ;;
    esac ;;
esac
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
running=$(cat "$MOCK_DIR/running")
url=${*: -1}
version=$OLD_REVISION
[[ $running != new ]] || version=$NEW_REVISION
[[ $running != none ]] || exit 7
if [[ $running == new ]]; then
  case "${SCENARIO:-}" in health-failure|rollback-start-failure|rollback-health-failure) exit 22 ;; esac
fi
[[ $running != old || ${SCENARIO:-} != rollback-health-failure ]] || exit 22
[[ $running != old || ${SCENARIO:-} != old-unhealthy ]] || exit 22
[[ $running != new || ${SCENARIO:-} != stale-version ]] || version=stale
case "$url" in
  */api/health) printf '{"status":"UP","protocolVersion":1,"version":"%s"}\n' "$version" ;;
  */online/)
    if [[ $running == new && ${SCENARIO:-} == frontend-down ]]; then echo '502 text/html'; else echo '200 text/html'; fi ;;
  */ws)
    if [[ "$*" != *"Origin: https://pcm.jwlee.xyz"* ]]; then echo '403 '
    elif [[ "$*" != *'Upgrade: websocket'* ]]; then echo '426 '
    elif [[ $running == new && ${SCENARIO:-} == ws-html ]]; then echo '200 text/html'
    else echo '401 '; fi ;;
  *) exit 1 ;;
esac
MOCK
# Git Bash lacks flock. This stub checks refusal handling; REAL_FLOCK runs the real one where it exists.
cat > "$fixture/bin/flock" <<'MOCK'
#!/usr/bin/env bash
[[ -z ${REAL_FLOCK:-} ]] || exec "$REAL_FLOCK" "$@"
[[ ${SCENARIO:-} != locked ]]
MOCK
cat > "$fixture/bin/mv" <<'MOCK'
#!/usr/bin/env bash
if [[ ${SCENARIO:-} == gate-write-failure && ${*: -1} == */start-gate.json ]]; then exit 1; fi
if [[ ${SCENARIO:-} == complete-write-failure && ${*: -1} == */start-gate.json ]]; then
  grep -q COMPLETE "$(printf '%s\n' "$@" | grep gate/ | head -n 1)" && exit 1
fi
exec "$REAL_MV" "$@"
MOCK
cat > "$fixture/bin/df" <<'MOCK'
#!/usr/bin/env bash
if [[ ${SCENARIO:-} == disk-low ]]; then printf 'h\nd 1 1 1000 1%% /\n'; else printf 'h\nd 1 1 99999999 1%% /\n'; fi
MOCK
# Force the health deadline to expire immediately after one failed attempt.
cat > "$fixture/bin/date" <<'MOCK'
#!/usr/bin/env bash
n=0; [[ ! -f "$MOCK_DIR/clock" ]] || n=$(cat "$MOCK_DIR/clock")
echo $((n+121)) > "$MOCK_DIR/clock"; echo "$n"
MOCK
printf '#!/usr/bin/env bash\n' > "$fixture/bin/sleep"
chmod +x "$fixture/bin/"*

# 다음 사례를 위해 서버 모의 상태를 처음으로 되돌린다
reset() {
  export SCENARIO=''
  rm -rf -- "$fixture/.local"
  rm -f "$fixture/clock" "$fixture/images" "$fixture/removed"
  printf 'BACKEND_IMAGE=%s\nBACKEND_MEM_LIMIT=768m\nBACKEND_HEAP=384m\nFRONTEND_IMAGE=front:keep\nOTHER_SETTING=keep\n' \
    "$old_image" > "$fixture/.env"
  echo "${1:-old}" > "$fixture/running"
  echo 1 > "$fixture/proc"
  echo 0 > "$fixture/active"
  : > "$fixture/holder"
  : > "$fixture/calls"
  : > "$fixture/internal"
  mkdir -p "$state/gate"
  printf 'image=%s\nrevision=%s\n' "$old_image" "$old_revision" > "$state/backend-lastHealthy"
  [[ ${1:-old} == old ]] || rm -f "$state/backend-lastHealthy"
}
# 지정한 스크립트를 실행하고 결과를 기록한다
run_script() {
  result=0
  { bash -c 'echo $$ > "$MOCK_DIR/script.pid"; exec bash "$@"' _ "$fixture/deploy/$1" "${@:2}" \
    > "$fixture/output" 2>&1 < /dev/null; } 2> /dev/null || result=$?
}
# 대상 이미지 배포를 실행한다
run_deploy() { run_script deploy-backend.sh "$target" "$revision" "$origin" "${1:-deploy-1}"; }
# 조건이 어긋나면 출력을 보이고 멈춘다
check() {
  "${@:2}" || { echo "FAIL $1"; cat "$fixture/output"; exit 1; }
}
# 파일에 내용이 없음을 확인한다
lacks() { ! grep -q -- "$1" "$2"; }
# 게이트가 닫혀 있고 파일도 닫힌 기록을 유지하는지 확인한다
gate_closed() { [[ -f "$gate_file" ]] && ! grep -q COMPLETE "$gate_file" && [[ -n $(cat "$fixture/holder") ]]; }
# 게이트가 열렸고 파일이 완료 기록인지 확인한다
gate_open() { grep -q '"phase":"COMPLETE"' "$gate_file" && [[ -z $(cat "$fixture/holder") ]]; }
# 교체가 일어나지 않았는지 확인한다
not_replaced() { lacks 'up -d' "$fixture/calls" && grep -q "BACKEND_IMAGE=$old_image" "$fixture/.env"; }
# 정상 배포는 prepare, 재확인, 교체, 해제 순서를 지키고 상태 파일을 남긴다
test_success() {
  reset
  run_deploy
  check 'success exit' [ "$result" = 0 ]
  check 'success word' grep -q "^DEPLOYED $target" "$fixture/output"
  check 'env updated' grep -q "^BACKEND_IMAGE=$target\$" "$fixture/.env"
  check 'env keeps other lines' grep -q '^BACKEND_MEM_LIMIT=768m$' "$fixture/.env"
  check 'env keeps frontend' grep -q '^FRONTEND_IMAGE=front:keep$' "$fixture/.env"
  check 'one image line' [ "$(grep -c '^BACKEND_IMAGE=' "$fixture/.env")" = 1 ]
  check 'current' grep -q "image=$target" "$state/backend-current"
  check 'lastHealthy' grep -q "revision=$revision" "$state/backend-lastHealthy"
  check 'pending removed' [ ! -e "$state/backend-pending" ]
  check 'gate open' gate_open
  check 'running new' grep -q new "$fixture/running"
  local order
  order=$(grep -n -E 'prepare|up -d' "$fixture/calls" | head -2 | cut -d: -f2-)
  check 'prepare first' grep -q prepare <<< "${order%%$'\n'*}"
  check 'gate modes' [ "$(stat -c %a "$state/gate")" = 755 ]
  check 'file modes' [ "$(stat -c %a "$gate_file")" = 644 ]
  check 'no gate temp left' [ "$(ls -A "$state/gate")" = start-gate.json ]
  echo 'PASS success'
}
# 같은 이미지가 이미 돌고 있으면 게임을 건드리지 않고 끝난다
test_already_running() {
  reset new
  printf 'image=%s\nrevision=%s\n' "$target" "$revision" > "$state/backend-current"
  run_deploy
  check 'already exit' [ "$result" = 0 ]
  check 'no prepare' lacks prepare "$fixture/calls"
  check 'no up' lacks 'up -d' "$fixture/calls"
  echo 'PASS already running'
}
# 첫 배포는 prepare 없이 닫힌 게이트 파일부터 쓰고 기동한다
test_first_deploy() {
  reset none
  rm -rf "$state/gate"
  run_deploy
  check 'first exit' [ "$result" = 0 ]
  check 'no prepare' lacks /prepare "$fixture/internal"
  check 'release used' grep -q /release "$fixture/internal"
  check 'gate open' gate_open
  echo 'PASS first deployment'
}
# 첫 배포 실패는 이전 정상이 없음을 구분해 보고하고 닫힌 채 남는다
test_first_deploy_failure() {
  reset none
  export SCENARIO=health-failure
  run_deploy
  check 'first failure exit' [ "$result" = 1 ]
  check 'no previous word' grep -q 'RECOVERY_REQUIRED.*NO_PREVIOUS_IMAGE' "$fixture/output"
  check 'gate closed' gate_closed
  check 'pending stays' [ -e "$state/backend-pending" ]
  run_script recover-backend.sh
  check 'recover keeps failure' [ "$result" = 1 ]
  check 'recover reports' grep -q NO_PREVIOUS_IMAGE "$fixture/output"
  check 'gate stays closed' lacks COMPLETE "$gate_file"
  check 'failed backend stopped' grep -q none "$fixture/running"
  check 'next deployment allowed' [ ! -e "$state/backend-pending" ]
  export SCENARIO=''
  run_deploy
  check 'retry works' [ "$result" = 0 ]
  check 'gate open after retry' gate_open
  echo 'PASS first deployment failure'
}
# 진행 게임이 있으면 HELD로 끝나고 아무것도 바꾸지 않는다
test_held() {
  reset
  export SCENARIO=prepare-held
  run_deploy
  check 'held exit' [ "$result" = 3 ]
  check 'held word' grep -q '^HELD' "$fixture/output"
  check 'not replaced' not_replaced
  check 'no pending' [ ! -e "$state/backend-pending" ]
  check 'no closed file' [ ! -e "$gate_file" ]
  echo 'PASS held'
}
# 게이트 파일 기록 실패면 교체하지 않고 현재 서버 차단을 푼다
test_gate_write_failure() {
  reset
  export SCENARIO=gate-write-failure
  run_deploy
  check 'write failure exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  check 'released' [ -z "$(cat "$fixture/holder")" ]
  check 'no pending' [ ! -e "$state/backend-pending" ]
  check 'no gate temp left' [ -z "$(ls -A "$state/gate")" ]
  echo 'PASS gate write failure'
}
# 재확인 불일치면 교체하지 않고 복구가 필요하다고 남긴다
test_recheck_mismatch() {
  reset
  export SCENARIO=recheck-mismatch
  run_deploy
  check 'recheck exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  check 'recovery word' grep -q RECOVERY_REQUIRED "$fixture/output"
  check 'gate closed' gate_closed
  echo 'PASS recheck mismatch'
  reset
  export SCENARIO=status-failure
  run_deploy
  check 'status failure exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  echo 'PASS recheck communication error'
  reset
  echo 1 > "$fixture/active"
  run_deploy
  check 'active exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  echo 'PASS recheck active game'
}
# prepare 실패 원인에 따라 남의 차단은 건드리지 않고 내 차단만 푼다
test_prepare_failures() {
  reset
  export SCENARIO=prepare-conflict
  run_deploy
  check 'conflict exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  check 'foreign gate kept' grep -q other-deployment "$fixture/holder"
  check 'no release' lacks /release "$fixture/internal"
  check 'no pending' [ ! -e "$state/backend-pending" ]
  echo 'PASS prepare conflict'
  reset
  export SCENARIO=prepare-lost
  run_deploy
  check 'lost exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  check 'own gate released' [ -z "$(cat "$fixture/holder")" ]
  check 'no pending' [ ! -e "$state/backend-pending" ]
  echo 'PASS prepare response lost'
}
# 다운로드와 검증 실패는 prepare 전에 끝나 새 게임을 막지 않는다
test_checks_before_prepare() {
  local scenario
  for scenario in pull-failure wrong-revision disk-low; do
    reset
    export SCENARIO=$scenario
    run_deploy
    check "$scenario exit" [ "$result" = 1 ]
    check "$scenario no prepare" lacks prepare "$fixture/calls"
    check "$scenario not replaced" not_replaced
    echo "PASS $scenario"
  done
}
# 잘못된 입력은 종료 코드 2로 거절한다
test_input() {
  reset
  run_script deploy-backend.sh "$repository:main" "$revision" "$origin" deploy-1
  check 'tag refused' [ "$result" = 2 ]
  run_script deploy-backend.sh "$target" short "$origin" deploy-1
  check 'revision refused' [ "$result" = 2 ]
  run_script deploy-backend.sh "$target" "$revision" http://x deploy-1
  check 'origin refused' [ "$result" = 2 ]
  run_script deploy-backend.sh "$target" "$revision" "$origin" 'bad"id'
  check 'deployment id refused' [ "$result" = 2 ]
  sed -i '/BACKEND_HEAP/d' "$fixture/.env"
  run_deploy
  check 'missing heap refused' [ "$result" = 2 ]
  check 'no docker' [ ! -s "$fixture/calls" ]
  echo 'PASS input'
}
# 정상 확인 실패는 어떤 항목이든 롤백하고 결과는 실패다
test_rollback_success() {
  local scenario
  for scenario in replace-failure health-failure stale-version frontend-down ws-html broken-mount; do
    reset
    export SCENARIO=$scenario
    run_deploy
    check "$scenario exit" [ "$result" = 1 ]
    check "$scenario word" grep -q ROLLED_BACK "$fixture/output"
    check "$scenario running" grep -q old "$fixture/running"
    check "$scenario gate" gate_open
    check "$scenario pending" [ ! -e "$state/backend-pending" ]
    check "$scenario env" grep -q "^BACKEND_IMAGE=$old_image\$" "$fixture/.env"
    check "$scenario lastHealthy" grep -q "revision=$old_revision" "$state/backend-lastHealthy"
    check "$scenario current" [ ! -e "$state/backend-current" ]
    echo "PASS rollback after $scenario"
  done
}
# 재부팅된 이전 서버는 새 프로세스 식별로 해제한다
test_rollback_uses_new_process() {
  reset
  export SCENARIO=health-failure
  run_deploy
  check 'release names the rolled-back process' grep -q 'release.*process-3' "$fixture/internal"
  echo 'PASS rollback process id'
}
# 롤백까지 실패하면 차단을 유지하고 RECOVERY_REQUIRED로 남긴다
test_rollback_failure() {
  local scenario
  for scenario in rollback-start-failure rollback-health-failure; do
    reset
    export SCENARIO=$scenario
    run_deploy
    check "$scenario exit" [ "$result" = 1 ]
    check "$scenario word" grep -q 'RECOVERY_REQUIRED.*ROLLBACK_FAILED' "$fixture/output"
    check "$scenario gate" gate_closed
    check "$scenario pending" [ -e "$state/backend-pending" ]
    echo "PASS $scenario"
  done
}
# 해제 응답만 믿지 않고 다시 읽어 열렸을 때만 성공이다
test_release_not_proved() {
  local scenario
  for scenario in release-failure release-lies complete-write-failure; do
    reset
    export SCENARIO=$scenario
    run_deploy
    check "$scenario exit" [ "$result" = 1 ]
    check "$scenario word" grep -q RECOVERY_REQUIRED "$fixture/output"
    check "$scenario pending" [ -e "$state/backend-pending" ]
    echo "PASS $scenario"
  done
}
# 강제 종료 뒤에는 시간이 지나도 거절되고 복구 뒤에만 열린다(O04)
test_killed_after_prepare() {
  local scenario
  for scenario in kill-after-prepare kill-after-gate; do
    reset
    export SCENARIO=$scenario
    run_deploy
    check "$scenario killed" [ "$result" -ge 128 ]
    check "$scenario pending" [ -e "$state/backend-pending" ]
    check "$scenario server closed" [ -n "$(cat "$fixture/holder")" ]
    if [[ $scenario == kill-after-gate ]]; then check 'gate file left' gate_closed; fi
    export SCENARIO=''
    echo 100000000 > "$fixture/clock"
    run_deploy other-deployment
    check "$scenario refused later" [ "$result" = 1 ]
    check "$scenario refusal word" grep -q RECOVERY_REQUIRED "$fixture/output"
    check "$scenario stays closed" [ -n "$(cat "$fixture/holder")" ]
    check "$scenario not replaced" not_replaced
    run_script recover-backend.sh
    check "$scenario recovered" [ "$result" = 0 ]
    check "$scenario recover word" grep -q 'RECOVERED rolled-back' "$fixture/output"
    check "$scenario gate open" gate_open
    check "$scenario pending gone" [ ! -e "$state/backend-pending" ]
    run_deploy other-deployment
    check "$scenario next deploy" [ "$result" = 0 ]
    echo "PASS $scenario then recovery"
  done
}
# 교체 뒤 끊겼고 새 서버가 정상이면 배포를 마무리한다
test_recover_completes() {
  reset
  export SCENARIO=kill-after-up
  run_deploy
  check 'killed' [ "$result" -ge 128 ]
  check 'gate stays closed' gate_closed
  export SCENARIO=''
  run_script recover-backend.sh
  check 'recovered' [ "$result" = 0 ]
  check 'word' grep -q 'RECOVERED completed' "$fixture/output"
  check 'current' grep -q "image=$target" "$state/backend-current"
  check 'lastHealthy' grep -q "revision=$revision" "$state/backend-lastHealthy"
  check 'gate open' gate_open
  check 'env target' grep -q "^BACKEND_IMAGE=$target\$" "$fixture/.env"
  echo 'PASS recovery completes'
}
# 교체 뒤 새 서버가 비정상이면 이전 서버로 되돌린다
test_recover_rolls_back() {
  reset
  export SCENARIO=kill-after-up
  run_deploy
  export SCENARIO=health-failure
  run_script recover-backend.sh
  check 'recovered' [ "$result" = 0 ]
  check 'word' grep -q 'RECOVERED rolled-back' "$fixture/output"
  check 'running old' grep -q old "$fixture/running"
  check 'gate open' gate_open
  check 'env old' grep -q "^BACKEND_IMAGE=$old_image\$" "$fixture/.env"
  echo 'PASS recovery rolls back'
}
# 복구 중 롤백이 실패하면 차단과 표시를 그대로 둔다
test_recover_failure() {
  reset
  export SCENARIO=kill-after-up
  run_deploy
  export SCENARIO=rollback-start-failure
  run_script recover-backend.sh
  check 'failed' [ "$result" = 1 ]
  check 'word' grep -q RECOVERY_REQUIRED "$fixture/output"
  check 'gate closed' gate_closed
  check 'pending' [ -e "$state/backend-pending" ]
  echo 'PASS recovery failure keeps the gate'
}
# 진행 게임이 보이면 복구도 서버를 교체하지 않는다
test_recover_protects_games() {
  reset
  export SCENARIO=kill-after-up
  run_deploy
  echo 1 > "$fixture/active"
  : > "$fixture/calls"
  export SCENARIO=health-failure
  run_script recover-backend.sh
  check 'refused' [ "$result" = 1 ]
  check 'no replacement' lacks 'up -d' "$fixture/calls"
  check 'running new' grep -q new "$fixture/running"
  check 'pending' [ -e "$state/backend-pending" ]
  echo 'PASS recovery protects live games'
  reset
  export SCENARIO=kill-after-gate
  run_deploy
  : > "$fixture/calls"
  export SCENARIO=old-unhealthy
  run_script recover-backend.sh
  check 'old unhealthy refused' [ "$result" = 1 ]
  check 'old not replaced' lacks 'up -d' "$fixture/calls"
  check 'old unhealthy pending' [ -e "$state/backend-pending" ]
  echo 'PASS recovery leaves an unhealthy previous server running'
}
# 복구는 잠금을 기다리지 않고 거절하며 표시를 건드리지 않는다
test_recover_locked() {
  reset
  export SCENARIO=kill-after-gate
  run_deploy
  export SCENARIO=locked
  : > "$fixture/calls"
  run_script recover-backend.sh
  check 'locked exit' [ "$result" = 1 ]
  check 'locked word' grep -q 'holds the lock' "$fixture/output"
  check 'gate closed' gate_closed
  check 'pending' [ -e "$state/backend-pending" ]
  check 'no docker' [ ! -s "$fixture/calls" ]
  echo 'PASS recovery refuses a held lock'
  export SCENARIO=''
  if [[ -z $real_flock ]]; then
    echo 'SKIP real flock contention: flock is not available on this machine'
    return
  fi
  export REAL_FLOCK=$real_flock
  exec 8> "$state/lock"
  "$real_flock" -n 8
  run_script recover-backend.sh
  exec 8>&-
  check 'real lock refused' [ "$result" = 1 ]
  run_script recover-backend.sh
  export REAL_FLOCK=''
  check 'real lock released' [ "$result" = 0 ]
  echo 'PASS real flock contention'
}
# 복구할 것이 없으면 아무것도 바꾸지 않는다
test_recover_nothing() {
  reset
  run_script recover-backend.sh
  check 'exit' [ "$result" = 0 ]
  check 'word' grep -q NOTHING_TO_RECOVER "$fixture/output"
  check 'no docker' [ ! -s "$fixture/calls" ]
  echo 'PASS nothing to recover'
}
# 배포 잠금이 잡혀 있으면 아무것도 하지 않는다
test_deploy_locked() {
  reset
  export SCENARIO=locked
  run_deploy
  check 'exit' [ "$result" = 1 ]
  check 'not replaced' not_replaced
  check 'no docker' [ ! -s "$fixture/calls" ]
  echo 'PASS deploy refuses a held lock'
}
# 정리는 보호 이미지와 최근 5개, 다른 프로젝트를 남기고 나머지만 지운다(O10)
test_prune() {
  reset
  local backend=$repository frontend=ghcr.io/mannal2/poker-chip-manager-frontend
  {
    echo "sha256:running $backend <none> sha256:running 2020-01-01T00:00:00Z"
    echo "sha256:current $backend <none> sha256:current 2020-01-02T00:00:00Z"
    echo "sha256:healthy $backend <none> sha256:healthy 2020-01-03T00:00:00Z"
    echo "sha256:held $backend <none> sha256:held 2020-01-04T00:00:00Z"
    echo "sha256:rollback poker-backend rollback-abc <none> 2020-01-05T00:00:00Z"
    echo "sha256:front $frontend <none> sha256:front 2020-01-06T00:00:00Z"
    echo "sha256:frontlast $frontend <none> sha256:frontlast 2020-01-06T12:00:00Z"
    local n
    for n in 1 2 3 4 5 6 7; do
      echo "sha256:b$n $backend <none> sha256:b$n 2021-01-0${n}T00:00:00Z"
    done
    echo "sha256:stale poker-backend rollback-stale <none> 2019-01-01T00:00:00Z"
    echo "sha256:f1 $frontend <none> sha256:f1 2021-02-01T00:00:00Z"
    echo "sha256:other ghcr.io/mannal2/other-app latest <none> 2018-01-01T00:00:00Z"
    echo "sha256:lookalike ghcr.io/mannal2/poker-chip-manager-backend-tools latest <none> 2018-01-02T00:00:00Z"
    echo "sha256:nginx nginx 1.29 <none> 2018-01-03T00:00:00Z"
  } > "$fixture/images"
  printf 'image=%s@sha256:current\nrevision=x\n' "$backend" > "$state/backend-current"
  printf 'image=%s@sha256:healthy\nrevision=x\n' "$backend" > "$state/backend-lastHealthy"
  printf 'deploymentId=d\ntarget=%s@sha256:held\nprevious=poker-backend:rollback-abc\n' "$backend" > "$state/backend-pending"
  printf 'image=%s@sha256:front\nrevision=x\n' "$frontend" > "$state/current"
  printf 'image=%s@sha256:frontlast\nrevision=x\n' "$frontend" > "$state/lastHealthy"
  run_script prune-images.sh
  check 'exit' [ "$result" = 0 ]
  check 'oldest backends removed' grep -q 'sha256:b1$' "$fixture/removed"
  check 'second oldest removed' grep -q 'sha256:b2$' "$fixture/removed"
  check 'stale rollback removed' grep -q 'rollback-stale$' "$fixture/removed"
  check 'exact removals' [ "$(wc -l < "$fixture/removed")" = 3 ]
  check 'no force' lacks 'rm -f' "$fixture/calls"
  check 'no force long' lacks '--force' "$fixture/calls"
  check 'no system prune' lacks 'system prune' "$fixture/calls"
  echo 'PASS prune protects images and other projects'
  export SCENARIO=locked
  rm -f "$fixture/removed"
  run_script prune-images.sh
  check 'locked exit' [ "$result" = 1 ]
  check 'locked removes nothing' [ ! -e "$fixture/removed" ]
  echo 'PASS prune refuses a held lock'
}

test_success
test_already_running
test_first_deploy
test_first_deploy_failure
test_held
test_gate_write_failure
test_recheck_mismatch
test_prepare_failures
test_checks_before_prepare
test_input
test_rollback_success
test_rollback_uses_new_process
test_rollback_failure
test_release_not_proved
test_killed_after_prepare
test_recover_completes
test_recover_rolls_back
test_recover_failure
test_recover_protects_games
test_recover_locked
test_recover_nothing
test_deploy_locked
test_prune
