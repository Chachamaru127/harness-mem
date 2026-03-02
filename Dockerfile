# Harness Memory Server - Dockerfile
# Bun ランタイムで memory-server を動かすコンテナイメージ

FROM oven/bun:1.3 AS base
WORKDIR /app

# 依存関係をインストール
COPY package.json package-lock.json ./
COPY memory-server/package.json ./memory-server/
RUN bun install --frozen-lockfile

# ソースコードをコピー
COPY memory-server/ ./memory-server/

# non-root ユーザーを追加
RUN addgroup --system --gid 1001 harness && \
    adduser --system --uid 1001 --ingroup harness harness

# データディレクトリ作成（所有者を harness に設定）
RUN mkdir -p /data && chown harness:harness /data

USER harness

# ポート
EXPOSE 37888

# デフォルト環境変数
ENV HARNESS_MEM_HOST=0.0.0.0
ENV HARNESS_MEM_PORT=37888
ENV HARNESS_MEM_DB_PATH=/data/harness-mem.db

# ヘルスチェック
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:37888/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "memory-server/src/index.ts"]
