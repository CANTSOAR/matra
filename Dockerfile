# Matra demo / production image.
#   docker build --build-arg MATRA_DEMO_MODE=1 -t matra .      (a fictional-data demo; a non-demo build must pin the
#                                                              matcher: MATRA_ATTESTATION_PLATFORM_PUBKEY + _MEASUREMENT,
#                                                              the org key and the OPRF key set, below)
#   docker run -p 8080:8080 -e MATRA_PEPPER=$(openssl rand -hex 32) -e MATRA_DEMO_BANNER=1 \
#     -e MATRA_OPRF_SHARE_1=… -e MATRA_OPRF_SHARE_2=… -e MATRA_OPRF_SHARE_3=… \
#     -e MATRA_PHONE_HASH_KEY=$(openssl rand -hex 32) -e MATRA_DEMO_MODE=1 -e MATRA_SMS_PROVIDER=mock \
#     -e MATRA_MATCHER_KEY=$(openssl rand -hex 32) -e MATRA_ATTESTATION_PLATFORM_KEY=$(openssl rand -hex 32) \
#     -v matra-data:/app/apps/server/data matra
# MATRA_DEMO_MODE=1 + the mock SMS provider are for fictional-data demos only; a real deployment sets
# MATRA_SMS_PROVIDER=twilio and TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID (docs/DEPLOY.md).
# The shares come from `npm run -w @matra/server oprf-ceremony` (threshold OPRF, default 2-of-3). The server refuses to
# start in production without every share (env, or *_FILE paths OUTSIDE the data volume) or the remote-holder config.
# Build-time pins for the web client (required for any non-demo build, which fails without them; values printed by the ceremony):
#   docker build --build-arg MATRA_OPRF_THRESHOLD=2 --build-arg MATRA_OPRF_GROUP_PUBKEY=… \
#     --build-arg MATRA_OPRF_SHARE_PUBKEYS=pk1,pk2,pk3 --build-arg MATRA_COUNSELOR_ROSTER_PUBKEY=… -t matra .
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
COPY apps/matcher/package.json apps/matcher/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
# `npm run build` first fetches + verifies the on-device speech model into apps/web/public/models (pinned, sha256-checked).
COPY scripts scripts
# Sealed-matching pins baked into the web build (empty = unpinned, development behaviour). See docs/DEPLOY.md.
ARG MATRA_OPRF_THRESHOLD=""
ARG MATRA_OPRF_GROUP_PUBKEY=""
ARG MATRA_OPRF_SHARE_PUBKEYS=""
ARG MATRA_COUNSELOR_ROSTER_PUBKEY=""
# The matcher this build trusts (both or neither; `npm run -w @matra/matcher measure`), and MATRA_DEMO_MODE=1 for a
# fictional-data demo build that accepts a SIMULATED matcher attestation (W18).
ARG MATRA_ATTESTATION_PLATFORM_PUBKEY=""
ARG MATRA_MATCHER_MEASUREMENT=""
ARG MATRA_DEMO_MODE=""
ENV MATRA_OPRF_THRESHOLD=$MATRA_OPRF_THRESHOLD \
    MATRA_OPRF_GROUP_PUBKEY=$MATRA_OPRF_GROUP_PUBKEY \
    MATRA_OPRF_SHARE_PUBKEYS=$MATRA_OPRF_SHARE_PUBKEYS \
    MATRA_COUNSELOR_ROSTER_PUBKEY=$MATRA_COUNSELOR_ROSTER_PUBKEY \
    MATRA_ATTESTATION_PLATFORM_PUBKEY=$MATRA_ATTESTATION_PLATFORM_PUBKEY \
    MATRA_MATCHER_MEASUREMENT=$MATRA_MATCHER_MEASUREMENT \
    MATRA_DEMO_MODE=$MATRA_DEMO_MODE
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
# the speech model runs in her browser (bundled into apps/web/dist above); no server process imports these (~470 MB)
 && rm -rf node_modules/@huggingface node_modules/onnxruntime-node node_modules/onnxruntime-web node_modules/onnxruntime-common node_modules/sharp node_modules/@img

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
# the in-process matcher (and `npm run -w @matra/matcher start` for a separate one)
COPY --from=build /app/apps/matcher apps/matcher
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/web/dist apps/web/dist
# (.dockerignore already keeps both data directories out; this is a second guard against a developer's dev keys)
RUN rm -rf apps/server/data apps/matcher/data && mkdir -p apps/server/data /data/.demo && chown -R node:node apps/server/data /data
# (/data: one volume per service in the Compose stack, compose.yaml)
USER node
VOLUME ["/app/apps/server/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node directly (not npm) so SIGTERM reaches the server; tsx runs the TypeScript sources.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
