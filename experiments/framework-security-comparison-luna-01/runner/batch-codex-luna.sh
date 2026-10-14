#!/usr/bin/env bash
# Luna本試行6セルを新規生成し、各実行の成功／失敗にかかわらず全セルを試す。
set -uo pipefail
cd "$(dirname "$0")"

MODEL="${MODEL:-gpt-6-luna}"
PREFIX="${RUN_PREFIX:-luna-study-01}"
ORDER=("nextjs-off" "none-on" "tanstack-off" "nextjs-on" "none-off" "tanstack-on")
for ((i = ${#ORDER[@]} - 1; i > 0; i--)); do
  j=$((RANDOM % (i + 1)))
  tmp="${ORDER[i]}"
  ORDER[i]="${ORDER[j]}"
  ORDER[j]="$tmp"
done

ORDER_FILE="$(pwd)/../runs/${PREFIX}-run-order.txt"
if [[ -e "$ORDER_FILE" ]]; then
  echo "実行順記録が既にあります: $ORDER_FILE" >&2
  exit 1
fi
{
  printf 'model=%s\n' "$MODEL"
  printf 'prefix=%s\n' "$PREFIX"
  printf 'randomized order, fixed before first run:\n'
  printf '%s\n' "${ORDER[@]}"
} > "$ORDER_FILE"

FAILED=0
for condition in "${ORDER[@]}"; do
  FW="${condition%-*}"
  SEC="${condition##*-}"
  ID="${PREFIX}-${FW}-${SEC}"
  echo "[$(date -u +%FT%TZ)] start $ID"
  if ./run-codex-generation.sh "$ID" "$FW" "$SEC" "$MODEL"; then
    echo "[$(date -u +%FT%TZ)] completed $ID"
  else
    CODE=$?
    echo "[$(date -u +%FT%TZ)] failed $ID exit=$CODE"
    FAILED=1
  fi
done

exit "$FAILED"
