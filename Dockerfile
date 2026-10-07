# Matra demo / production image.
#   docker build -t matra .
#   docker run -p 8080:8080 -e MATRA_PEPPER=$(openssl rand -hex 32) -e MATRA_DEMO_BANNER=1 \
#     -e MATRA_OPRF_KEY_A=$(openssl rand -hex 32) -e MATRA_OPRF_KEY_B=$(openssl rand -hex 32) \
#     -v matra-data:/app/apps/server/data matra
# The server refuses to start in production without both OPRF key shares (env, or *_FILE paths OUTSIDE the data volume).
# Build-time pins for the web client (recommended for any non-demo build):
#   docker build --build-arg MATRA_OPRF_PUBKEY_A=… --build-arg MATRA_OPRF_PUBKEY_B=… --build-arg MATRA_COUNSELOR_ROSTER_PUBKEY=… -t matra .
# See docs/DEPLOY.md. Never put real survivor data on an instance before the pre-launch checklist is done.

# ── build: install everything, build the web app, then drop dev dependencies ──
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 ships prebuilt binaries; the toolchain is only a fallback if none matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
# `npm run build` first fetches + verifies the on-device speech model into apps/web/public/models (pinned, sha256-checked).
COPY scripts scripts
# Sealed-matching pins baked into the web build (empty = unpinned, development behaviour). See docs/DEPLOY.md.
ARG MATRA_OPRF_PUBKEY_A=""
ARG MATRA_OPRF_PUBKEY_B=""
ARG MATRA_COUNSELOR_ROSTER_PUBKEY=""
ENV MATRA_OPRF_PUBKEY_A=$MATRA_OPRF_PUBKEY_A \
    MATRA_OPRF_PUBKEY_B=$MATRA_OPRF_PUBKEY_B \
    MATRA_COUNSELOR_ROSTER_PUBKEY=$MATRA_COUNSELOR_ROSTER_PUBKEY
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ── runtime: non-root, only what the server needs ──
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    MATRA_DB_PATH=/app/apps/server/data/matra.db
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/server apps/server
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/web/dist apps/web/dist
RUN rm -rf apps/server/data && mkdir -p apps/server/data && chown -R node:node apps/server/data
USER node
VOLUME ["/app/apps/server/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node directly (not npm) so SIGTERM reaches the server; tsx runs the TypeScript sources.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
