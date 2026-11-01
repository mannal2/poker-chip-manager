#!/usr/bin/env bash
# 서버 사양을 읽기만 하고 key=value로 출력한다 (비밀값·환경변수는 출력하지 않는다)
set -u
url=https://pcm.jwlee.xyz/local/

# 값이 비어 있으면 unknown을 돌려준다
or_unknown() { if [[ -n "${1:-}" ]]; then printf '%s' "$1"; else printf 'unknown'; fi; }

# key=value 한 줄을 출력한다
emit() { printf '%s=%s\n' "$1" "$(or_unknown "${2:-}")"; }

# /proc/meminfo에서 항목을 MiB로 읽는다
meminfo_mib() {
  local kb
  kb=$(awk -v key="$1:" '$1 == key {print $2; exit}' /proc/meminfo 2>/dev/null || true)
  [[ "$kb" =~ ^[0-9]+$ ]] && printf '%s' "$((kb / 1024))"
  return 0
}

# 시간 제한(15초)을 걸어 명령을 실행한다 timeout이 없으면 그대로 실행한다
bounded() { if command -v timeout > /dev/null 2>&1; then timeout 15 "$@"; else "$@"; fi; }

# 디스크 용량을 MiB로 읽는다 도커 데이터 경로가 없으면 현재 경로를 쓴다
disk_mib() {
  local line pattern='^[0-9]+ [0-9]+$'
  line=$(df -Pk /var/lib/docker 2>/dev/null | awk 'END {print $2, $4}' || true)
  [[ "$line" =~ $pattern ]] || line=$(df -Pk . 2>/dev/null | awk 'END {print $2, $4}' || true)
  [[ "$line" =~ $pattern ]] || return 0
  if [[ "$1" == total ]]; then printf '%s' "$((${line% *} / 1024))"; else printf '%s' "$((${line#* } / 1024))"; fi
}

emit arch "$(uname -m 2>/dev/null || true)"
emit memory_total_mib "$(meminfo_mib MemTotal)"
emit memory_available_mib "$(meminfo_mib MemAvailable)"
emit swap_total_mib "$(meminfo_mib SwapTotal)"
emit swap_free_mib "$(meminfo_mib SwapFree)"
emit disk_total_mib "$(disk_mib total)"
emit disk_available_mib "$(disk_mib available)"

stats=''
if ! command -v docker > /dev/null 2>&1; then
  emit docker_access missing
  emit docker_version ''
  emit compose_version ''
elif bounded docker info > /dev/null 2>&1; then
  emit docker_access ok
  emit docker_version "$(bounded docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  emit compose_version "$(bounded docker compose version --short 2>/dev/null || true)"
  # 실행 중 컨테이너의 이름과 메모리 사용량만 출력한다
  stats=$(bounded docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null || true)
else
  emit docker_access denied
  emit docker_version ''
  emit compose_version ''
fi
if [[ -n "$stats" ]]; then
  while read -r name usage; do
    emit "container_memory.${name}" "$usage"
  done <<< "$stats"
else
  emit container_memory ''
fi

if command -v curl > /dev/null 2>&1; then
  code=$(curl -q --noproxy '*' -s -o /dev/null -m 10 -w '%{http_code}' "$url" 2>/dev/null || true)
  [[ "$code" == 000 ]] && code=''
else
  code=''
fi
emit local_http_status "$code"
exit 0
