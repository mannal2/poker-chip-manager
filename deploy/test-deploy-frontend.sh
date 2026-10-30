#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root. Docker/HTTPS are simulated; no server is touched.
mkdir -p .local
fixture=$(mktemp -d "$PWD/.local/deploy-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/deploy" "$fixture/bin"
cp deploy/deploy-frontend.sh "$fixture/deploy/"
touch "$fixture/compose.yaml"
export MOCK_DIR="$fixture" PATH="$fixture/bin:$PATH"
target="ghcr.io/mannal2/poker-chip-manager-frontend@sha256:$(printf 'a%.0s' {1..64})"
revision=$(printf 'b%.0s' {1..40})

cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$MOCK_DIR/calls"
case "$1" in
  pull) [[ ${SCENARIO:-} != pull-failure ]] ;;
  inspect)
    if [[ $(cat "$MOCK_DIR/running") == new ]]; then echo new-id; else echo old-id; fi ;;
  tag) : ;;
  image)
    if [[ "$*" == *org.opencontainers.image.revision* ]]; then
      if [[ ${SCENARIO:-} == wrong-revision ]]; then echo wrong; else printf 'b%.0s' {1..40}; fi
    elif [[ "$*" == *Size* ]]; then echo 1000
    else echo new-id; fi ;;
  run)
    if [[ "$*" == *sha256sum* ]]; then
      printf '%s  ./local/index.html\n' "$(printf '%s' healthy | sha256sum | cut -d' ' -f1)"
    fi ;;
  compose)
    if [[ "$*" == *'ps -q frontend'* ]]; then echo container-id
    elif [[ "$*" == *'up -d'* ]]; then
      if [[ "$FRONTEND_IMAGE" == poker-frontend:rollback-* ]]; then
        echo old > "$MOCK_DIR/running"
        [[ ${SCENARIO:-} != rollback-failure ]]
      else
        echo new > "$MOCK_DIR/running"
        [[ ${SCENARIO:-} != replace-failure ]]
      fi
    fi ;;
esac
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ ${SCENARIO:-} == health-failure || ${SCENARIO:-} == rollback-failure ]]; then
  [[ $(cat "$MOCK_DIR/running") != new ]] || exit 22
fi
if [[ ${SCENARIO:-} == corrupt-response && $(cat "$MOCK_DIR/running") == new ]]; then
  while (($#)); do
    if [[ "$1" == --output ]]; then printf corrupt > "$2"; exit; fi
    shift
  done
fi
while (($#)); do
  if [[ "$1" == --output ]]; then printf healthy > "$2"; exit; fi
  shift
done
exit 1
MOCK
# Git Bash lacks flock. This stub checks the script's handling of lock refusal;
# real util-linux locking must also be exercised on the Ubuntu server.
cat > "$fixture/bin/flock" <<'MOCK'
#!/usr/bin/env bash
[[ ${SCENARIO:-} != locked ]]
MOCK
# Force the health deadline to expire immediately after one failed attempt.
cat > "$fixture/bin/date" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == +%s ]]; then
  n=0; [[ ! -f "$MOCK_DIR/clock" ]] || n=$(cat "$MOCK_DIR/clock")
  echo $((n+121)) > "$MOCK_DIR/clock"; echo "$n"
else echo test-deployment; fi
MOCK
chmod +x "$fixture/bin/"*

run_case() {
  export SCENARIO=$1
  rm -rf -- "$fixture/.local"
  rm -f "$fixture/clock"
  printf 'FRONTEND_IMAGE=old:manual\nOTHER_SETTING=keep\n' > "$fixture/.env"
  printf old > "$fixture/running"
  : > "$fixture/calls"
  if [[ "$SCENARIO" == pending ]]; then
    mkdir -p "$fixture/.local/deploy"; echo interrupted > "$fixture/.local/deploy/pending"
  fi
  result=0
  bash "$fixture/deploy/deploy-frontend.sh" "$target" "$revision" https://pcm.jwlee.xyz > "$fixture/output" 2>&1 || result=$?
  if [[ "$SCENARIO" == success ]]; then
    [[ $result == 0 ]] || { cat "$fixture/output"; return 1; }
    grep -q "FRONTEND_IMAGE=$target" "$fixture/.env"
    grep -q OTHER_SETTING=keep "$fixture/.env"
    [[ -f "$fixture/.local/deploy/current" && ! -f "$fixture/.local/deploy/pending" ]]
    [[ $(cat "$fixture/running") == new ]]
  else
    [[ $result != 0 ]] || { echo "Unexpected success: $SCENARIO"; return 1; }
    case "$SCENARIO" in
      pending|locked|pull-failure|wrong-revision)
        ! grep -q 'up -d' "$fixture/calls"
        grep -q FRONTEND_IMAGE=old:manual "$fixture/.env" ;;
      replace-failure|health-failure|corrupt-response)
        [[ $(cat "$fixture/running") == old && ! -f "$fixture/.local/deploy/pending" ]]
        grep -q FRONTEND_IMAGE=old:manual "$fixture/.env" ;;
      rollback-failure) [[ -f "$fixture/.local/deploy/pending" ]] ;;
    esac
  fi
  echo "PASS $SCENARIO"
}
for scenario in success locked pending pull-failure wrong-revision replace-failure health-failure corrupt-response rollback-failure; do
  run_case "$scenario"
done
