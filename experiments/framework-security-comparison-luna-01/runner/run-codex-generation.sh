#!/usr/bin/env bash
# Codex CLIをホスト上で起動し、生成作業をrun専用workspaceに限定する。
# ChatGPTログインを使う。認証ファイルをコンテナへコピーしない。
#
# 使い方:
#   ./run-codex-generation.sh <run-id> <none|nextjs|tanstack> <on|off> <model-id>
#
# Codexのモデル通信はホスト側で行い、モデルが実行する作業は
# --sandbox workspace-write と -C で指定したRUN/workspace内に置く。

set -euo pipefail
cd "$(dirname "$0")"

ID="${1:?実行IDを指定してください}"
FW="${2:?フレームワーク（none|nextjs|tanstack）を指定してください}"
SEC="${3:?セキュリティ指示（on|off）を指定してください}"
MODEL="${4:?モデルIDを指定してください}"

[[ "$ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "不正な実行ID" >&2; exit 2; }
case "$FW" in none|nextjs|tanstack) ;; *) echo "不明なフレームワーク: $FW" >&2; exit 2 ;; esac
case "$SEC" in on|off) ;; *) echo "on か off を指定してください" >&2; exit 2 ;; esac
command -v codex >/dev/null || { echo "Codex CLIが必要です" >&2; exit 2; }

# ChatGPTプラン認証を意図した実験なので、APIキー認証では実行しない。
LOGIN_STATUS="$(codex login status 2>&1 || true)"
if ! rg -q 'Logged in using ChatGPT' <<<"$LOGIN_STATUS"; then
  echo "Codex CLIがChatGPTアカウントでサインインしていません。実行を中止します。" >&2
  exit 2
fi

RUN="$(pwd)/../runs/$ID"
if [[ -e "$RUN" ]]; then
  echo "実行IDが既にあります: $ID" >&2
  exit 1
fi
mkdir -p "$RUN/workspace" "$RUN/logs"

{
  # Docker用仕様書の /workspace を、この試行専用の実cwdに置き換える。
  sed 's|/workspace|この実行の作業ディレクトリ|' prompts/base.md
  echo
  cat "prompts/framework-$FW.md"
  echo
  if [[ "$SEC" == "on" ]]; then cat prompts/security-on.md; echo; fi
} > "$RUN/prompt.md"

printf '%s\n' "$MODEL" > "$RUN/model.txt"
printf '%s\n' "$(codex --version 2>&1 | tail -n 1)" > "$RUN/cli-version.txt"
printf '%s\n' "ChatGPT sign-in" > "$RUN/auth-method.txt"
printf '%s\n' "workspace-write; working directory: workspace/" > "$RUN/sandbox.txt"
uname -a > "$RUN/host.txt"
printf '%s\n' 'Shell network: proxy allowlist registry.npmjs.org only; Codex web search disabled' > "$RUN/network-policy.txt"
date -u +%FT%TZ > "$RUN/started_at"

set +e
codex exec --ephemeral --ignore-user-config --skip-git-repo-check \
  --cd "$RUN/workspace" --model "$MODEL" --sandbox workspace-write --json \
  -c sandbox_workspace_write.network_access=true \
  -c features.network_proxy.enabled=true \
  -c 'features.network_proxy.domains={ "registry.npmjs.org" = "allow" }' \
  -c 'web_search="disabled"' \
  -c 'shell_environment_policy.inherit="core"' \
  -c shell_environment_policy.ignore_default_excludes=false \
  --output-last-message "$RUN/logs/final-message.txt" - \
  < "$RUN/prompt.md" > "$RUN/logs/events.jsonl" 2> "$RUN/logs/stderr.txt"
CODE=$?
set -e

date -u +%FT%TZ > "$RUN/finished_at"
echo "$CODE" > "$RUN/status.txt"
echo "終了コード: $CODE （記録: ${RUN}）"
exit "$CODE"
