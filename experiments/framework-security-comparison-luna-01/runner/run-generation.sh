#!/usr/bin/env bash
# 1件の生成を、新しいコンテナで実行する。
#
# 使い方:
#   CLAUDE_CODE_OAUTH_TOKEN=... ./run-generation.sh <実行ID> <none|nextjs|tanstack> <on|off> <モデルID>
# 例:
#   ./run-generation.sh pilot-001 nextjs off claude-sonnet-5-5
#
# 出力: ../runs/<実行ID>/ （prompt.md, workspace/, logs/, status.txt）
# トークンは環境変数から名前だけで渡し、コマンドラインや記録には残さない。

set -euo pipefail
cd "$(dirname "$0")"

ID="${1:?実行IDを指定してください}"
FW="${2:?フレームワーク（none|nextjs|tanstack）を指定してください}"
SEC="${3:?セキュリティ指示（on|off）を指定してください}"
MODEL="${4:?モデルIDを指定してください}"

case "$FW" in none|nextjs|tanstack) ;; *) echo "不明なフレームワーク: $FW" >&2; exit 1 ;; esac
case "$SEC" in on|off) ;; *) echo "on か off を指定してください" >&2; exit 1 ;; esac
: "${CLAUDE_CODE_OAUTH_TOKEN:?環境変数 CLAUDE_CODE_OAUTH_TOKEN を設定してください}"

RUN="$(pwd)/../runs/$ID"
if [[ -e "$RUN" ]]; then
  echo "実行IDが既にあります: $ID" >&2
  exit 1
fi
mkdir -p "$RUN/workspace" "$RUN/logs"

# プロンプトを組み立て、実行記録として残す
{
  cat prompts/base.md
  echo
  cat "prompts/framework-$FW.md"
  echo
  if [[ "$SEC" == "on" ]]; then cat prompts/security-on.md; echo; fi
} > "$RUN/prompt.md"
echo "$MODEL" > "$RUN/model.txt"
date -u +%FT%TZ > "$RUN/started_at"

IMAGE="sns-gen:claude-code-2.1.296"
docker build -q --build-arg HOST_UID="$(id -u)" -t "$IMAGE" . >/dev/null

set +e
docker run --rm --name "gen-$ID" \
  --add-host host.docker.internal:host-gateway \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 4g --cpus 2 --pids-limit 512 \
  -e CLAUDE_CODE_OAUTH_TOKEN \
  -e OIDC_ISSUER="http://host.docker.internal:4500" \
  -e MODEL="$MODEL" \
  -v "$RUN/prompt.md:/input/prompt.md:ro" \
  -v "$RUN/workspace:/workspace" \
  -v "$RUN/logs:/logs" \
  "$IMAGE" \
  bash -c 'timeout 3600 claude -p "$(cat /input/prompt.md)" --model "$MODEL" --dangerously-skip-permissions --output-format stream-json --verbose > /logs/events.jsonl 2> /logs/stderr.txt'
CODE=$?
set -e

date -u +%FT%TZ > "$RUN/finished_at"
echo "$CODE" > "$RUN/status.txt"
echo "終了コード: $CODE （記録: ${RUN}）"
