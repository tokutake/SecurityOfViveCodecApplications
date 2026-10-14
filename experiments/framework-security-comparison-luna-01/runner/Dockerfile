# 生成専用の実行環境。1回の生成ごとに新しいコンテナを使う。
# ベースイメージは digest で固定し、Claude Code も版を固定する。
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ARG CLAUDE_CODE_VERSION=2.1.296
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# ホストのユーザーや設定ディレクトリは持ち込まない。作業領域は /workspace だけ
# 作業領域（ホストのマウント）の所有者と合わせるため、ホストのUIDを渡す
ARG HOST_UID=1001
RUN useradd -m -u ${HOST_UID} runner && mkdir -p /workspace /input /logs && chown runner:runner /workspace /logs
USER runner
WORKDIR /workspace
