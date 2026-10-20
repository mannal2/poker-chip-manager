#!/bin/sh
set -eu

# Run in the production Nginx image so cp is the same BusyBox implementation.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/source" "$fixture/shared"
printf new-release > "$fixture/source/new.js"
printf replacement > "$fixture/source/existing.js"
printf previous-release > "$fixture/shared/existing.js"
printf retained > "$fixture/shared/old.js"

# Exercise the command from the deployment script, rather than a copy of it.
copy_command=$(awk '/^  "\$target" -c / { sub(/^.* -c \047/, ""); sub(/\047$/, ""); print }' "$script_dir/deploy-frontend.sh")
test -n "$copy_command"
copy_command=$(printf '%s\n' "$copy_command" | sed \
  -e "s|/usr/share/nginx/html/assets|$fixture/source|g" \
  -e "s|/release-assets|$fixture/shared|g")
sh -c "$copy_command"

test -f "$fixture/shared/new.js" || {
  echo 'FAIL: new assets were not copied into the existing shared directory.' >&2
  exit 1
}
test "$(cat "$fixture/shared/new.js")" = new-release
test "$(cat "$fixture/shared/existing.js")" = previous-release
test "$(cat "$fixture/shared/old.js")" = retained
echo 'PASS: new assets copied; existing and old assets preserved.'
