#!/usr/bin/env bash
set -euo pipefail

# Runs on the CI runner. plan-release.sh <backendChanged> <frontendChanged> <backendResult>
# prints frontend=deploy|hold|skip. Exit code 2 means invalid input.
backend_changed=${1:-}
frontend_changed=${2:-}
backend_result=${3:-}
[[ "$backend_changed" == true || "$backend_changed" == false ]] || { echo 'backendChanged must be true or false.' >&2; exit 2; }
[[ "$frontend_changed" == true || "$frontend_changed" == false ]] || { echo 'frontendChanged must be true or false.' >&2; exit 2; }
case "$backend_result" in
  deployed | held | failed | skipped) ;;
  *) echo 'backendResult must be deployed, held, failed or skipped.' >&2; exit 2 ;;
esac

if [[ "$frontend_changed" == false ]]; then
  echo 'frontend=skip'
elif [[ "$backend_changed" == true && ( "$backend_result" == held || "$backend_result" == failed ) ]]; then
  # This frontend may need a backend that did not arrive.
  echo 'frontend=hold'
else
  echo 'frontend=deploy'
fi
