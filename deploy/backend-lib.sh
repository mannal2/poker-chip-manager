# Sourced by deploy-backend.sh and recover-backend.sh after they take the lock path
# variables: project, state, pending, gate_dir, gate_file. The caller sets
# deployment_id and origin. Nothing here runs on its own.

# 백엔드 이미지 변수만 지운 환경에서 Compose를 실행한다
compose() { env -u BACKEND_IMAGE docker compose --project-directory "$project" "$@"; }
# 파일 하나를 임시 파일 뒤 mv로 교체한다
replace_file() {
  local destination=$1 content=$2
  printf '%s' "$content" > "$destination.tmp" && mv "$destination.tmp" "$destination"
}
# 게이트 파일을 컨테이너가 읽을 수 있는 권한으로 원자적으로 교체하고 디스크에 내린다
write_gate() {
  local phase=$1 temporary
  temporary=$(mktemp "$gate_dir/.start-gate.XXXXXX") || return 1
  if printf '{"deploymentId":"%s","phase":"%s"}\n' "$deployment_id" "$phase" > "$temporary" \
    && chmod 0644 "$temporary" && mv "$temporary" "$gate_file" && sync; then return 0; fi
  rm -f -- "$temporary"
  return 1
}
# 게이트 파일이 이 배포가 닫은 기록이면 참이다
gate_is_mine() {
  [[ -f "$gate_file" ]] && grep -q "\"deploymentId\":\"$deployment_id\"" "$gate_file" \
    && ! grep -q '"phase":"COMPLETE"' "$gate_file"
}
# 배포 기록에서 필드 하나를 읽는다
pending_field() { sed -n "s/^$1=//p" "$pending"; }
# 배포 기록의 단계만 바꾼다
set_phase() {
  sed "s/^phase=.*/phase=$1/" "$pending" > "$pending.tmp" && mv "$pending.tmp" "$pending"
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
# 실행 중인 backend의 이미지 ID를 출력한다. 없으면 빈 값이고 알 수 없으면 실패한다
running_image() {
  local active
  active=$(compose ps -q backend) || return 1
  [[ -n "$active" ]] || return 0
  docker inspect --format '{{.Image}}' "$active"
}
# 교체해도 진행 게임을 지우지 않는다는 근거가 있을 때만 참이다
replace_is_safe() {
  local phase=$1 active response
  active=$(compose ps -q backend) || return 1
  [[ -n "$active" ]] || return 0
  if response=$(read_status); then
    [[ "$(plain_field "$response" startsClosed)" == true \
      && "$(plain_field "$response" activeTournaments)" == 0 ]]
    return
  fi
  # The old process proved closed with no games before these phases, but that says
  # nothing about a new backend that is running: its mount may have booted it open.
  # So with no status, only the proved process itself may go. Releasing voids even that.
  [[ "$phase" == replacing || "$phase" == rolling-back ]] && gate_is_mine \
    && [[ -n "$previous_id" && "$(docker inspect --format '{{.Image}}' "$active")" == "$previous_id" ]]
}
# 게이트 파일은 닫혔는데 서버가 열렸다고 읽히면 참이다
mount_is_broken() {
  [[ "$(plain_field "$1" startsClosed)" == false ]] && gate_is_mine
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
# 서버가 이 배포로 닫혀 있으면 0, 읽히지 않으면 1, 열린 것이 읽히면 2를 돌려준다
gate_held() {
  local response
  response=$(read_status) || return 1
  [[ "$(plain_field "$response" startsClosed)" != false ]] || return 2
  [[ "$(plain_field "$response" startsClosed)" == true \
    && "$(string_field "$response" deploymentId)" == "$deployment_id" ]]
}
# 기대한 이미지가 실행 중이고 edge 확인을 통과할 때까지 최대 120초 기다린다
healthy() {
  local expected_id=$1 expected_revision=$2 must_hold_gate=$3 deadline actual held
  deadline=$(( $(date +%s) + 120 ))
  while :; do
    held=0
    if [[ "$must_hold_gate" == yes ]]; then gate_held || held=$?; fi
    # A server that reads open will not close by waiting.
    [[ "$held" != 2 ]] || return 1
    actual=$(running_image) || actual=''
    if [[ "$held" == 0 && "$actual" == "$expected_id" ]] && check_edge "$expected_revision"; then return 0; fi
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
  [[ "$closed" == false || "$holder" == "$deployment_id" \
    || ( "${accept_unknown_holder:-no}" == yes && "$holder" == unknown ) ]] || return 1
  # From here starts may open, so nothing may assume this backend is empty any more.
  if [[ -e "$pending" ]]; then set_phase releasing || return 1; fi
  write_gate COMPLETE || return 1
  if [[ "$closed" != false ]]; then
    internal_post release "{\"deploymentId\":\"$holder\",\"processId\":\"$(string_field "$response" processId)\"}" \
      > /dev/null || return 1
  fi
  response=$(read_status) || return 1
  [[ "$(plain_field "$response" startsClosed)" == false ]]
}
