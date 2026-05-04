# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src

RUN pnpm install --frozen-lockfile && pnpm build

FROM rust:1-bookworm AS host-build
WORKDIR /app

COPY host/Cargo.toml host/Cargo.lock ./host/
COPY host/src ./host/src

RUN cargo build --release --manifest-path host/Cargo.toml

FROM debian:bookworm-slim AS host-runtime

ENV SDKWORK_VIDEO_CUT_RUNTIME_MODE=container-private
ENV SDKWORK_VIDEO_CUT_BIND_HOST=0.0.0.0
ENV SDKWORK_VIDEO_CUT_PORT=6177
ENV SDKWORK_VIDEO_CUT_WORKSPACE_ROOT=/data/workspace
ENV SDKWORK_VIDEO_CUT_AUTH_MODE=reverse-proxy

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin video-cut \
  && mkdir -p /data/workspace \
  && chown -R video-cut:video-cut /data

COPY --from=host-build /app/host/target/release/sdkwork-video-cut-host /usr/local/bin/sdkwork-video-cut-host

USER video-cut
EXPOSE 6177
VOLUME ["/data/workspace"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:6177/api/video-cut/v1/health || exit 1

CMD ["sdkwork-video-cut-host"]

FROM nginx:1.27-alpine AS web-runtime

COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html

EXPOSE 80
