#!/usr/bin/env bash
# 残りの生成を順番に実行する。失敗しても次の条件へ進み、結果は各 runs/<ID>/status.txt に残る。
set -uo pipefail
cd "$(dirname "$0")"
set -a
source ../../generation-auth/claude-oauth-token.env
set +a

for model in claude-sonnet-4-6:s4 claude-sonnet-5:s5 claude-sonnet-5-5:s55; do
  m="${model%%:*}"; short="${model##*:}"
  for fw in none nextjs tanstack; do
    for sec in off on; do
      id="${short}-${fw}-${sec}"
      # パイロット（s55-nextjs-off）は実行済みなので飛ばす
      [[ "$id" == "s55-nextjs-off" ]] && continue
      [[ -e "../runs/$id" ]] && continue
      echo "[$(date -u +%FT%TZ)] start $id"
      ./run-generation.sh "$id" "$fw" "$sec" "$m" || echo "failed: $id"
      echo "[$(date -u +%FT%TZ)] end $id"
    done
  done
done
echo "ALL DONE"
