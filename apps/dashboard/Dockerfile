# syntax=docker/dockerfile:1.7
#
# Repro dashboard image. Published as ripwords/reprojs-dashboard on Docker Hub.
#
# Same image serves two purposes via the command:
#   - default      : `bun .output/server/index.mjs` (starts the Nuxt server)
#   - "migrate"    : `drizzle-kit migrate` (applies DB migrations, exits 0)
#
# The compose file runs the migrator service first (depends_on:
# condition: service_completed_successfully), then the dashboard.

# ─────────────────────────────────────────────────────────────────
# Stage 1: deps — resolve workspace deps; cached unless manifests change
# ─────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4 AS deps
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps/dashboard/package.json apps/dashboard/
# apps/extension doesn't ship in the dashboard image, but its package.json
# contributes to the workspace graph in bun.lock. Omit it and
# `bun install --frozen-lockfile` treats the lockfile as drifted.
COPY apps/extension/package.json apps/extension/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk-utils/package.json packages/sdk-utils/
COPY packages/recorder/package.json packages/recorder/
COPY packages/expo/package.json packages/expo/
COPY packages/integrations/github/package.json packages/integrations/github/

# --ignore-scripts skips the better-sqlite3 native build (a transitive dep of
# @better-auth/cli we only use at dev time; the runtime pg driver is pure JS).
RUN bun install --frozen-lockfile --ignore-scripts

# ─────────────────────────────────────────────────────────────────
# Stage 2: build — compile the Nuxt app into a self-contained server
# ─────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo

COPY . .
# Dashboard Nuxt server + the framework-agnostic SDK IIFE bundle. The IIFE
# is served by /sdk/repro.iife.js at runtime so embedders can <script>-load
# the widget directly from the dashboard origin without also deploying
# packages/core as an npm dependency. Both builds are independent; running
# them sequentially keeps the Dockerfile readable and the layer cache
# simple (shared lockfile + node_modules above).
RUN bun --filter dashboard build \
 && bun run sdk:build

# ─────────────────────────────────────────────────────────────────
# Stage 3: runtime — slim image with Nuxt output + migration tooling
# ─────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app

# Non-root runtime user
RUN groupadd --system --gid 1001 repro \
 && useradd --system --uid 1001 --gid 1001 --create-home --shell /bin/sh repro

# Nuxt .output is a self-contained Node server — no workspace node_modules needed
COPY --from=build --chown=repro:repro /repo/apps/dashboard/.output ./.output

# Migration artifacts: drizzle-kit reads these at runtime
COPY --from=build --chown=repro:repro /repo/apps/dashboard/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=repro:repro /repo/apps/dashboard/server/db ./server/db

# Email templates read via fs.readFile at runtime — Nuxt doesn't bundle them.
COPY --from=build --chown=repro:repro /repo/apps/dashboard/server/emails ./server/emails

# SDK IIFE bundle — served by the dashboard at `/sdk/repro.iife.js` so host
# pages can embed the widget via a single <script> tag without needing the
# npm package on the client side. The `SDK_PATH` env var below points the
# route handler directly at this file; without it, the handler's dev-time
# relative path (../../packages/core/dist/...) resolves outside /app and
# 503s at runtime.
COPY --from=build --chown=repro:repro /repo/packages/core/dist/repro.iife.js ./sdk/repro.iife.js

# Pre-create the local-disk attachments root owned by `repro`. Docker seeds a
# newly-initialized named volume with the image directory's ownership, so
# fresh deployments inherit the correct UID and the non-root server can
# write without a privileged sidecar.
RUN mkdir -p /data/attachments && chown -R repro:repro /data

# drizzle-kit standalone (for the migrator command); tiny, ~30MB with its deps
RUN bun add --cwd /app drizzle-kit@latest drizzle-orm pg

# Healthcheck helper — reads NITRO_PORT so it stays in sync with the server
# if the port ever changes. Kept inside the image so compose.yaml doesn't
# carry escaped-quote soup.
RUN printf '%s\n' \
  'const port = process.env.NITRO_PORT ?? "3000"' \
  'fetch(`http://127.0.0.1:${port}/api/health`)' \
  '  .then((r) => process.exit(r.ok ? 0 : 1))' \
  '  .catch(() => process.exit(1))' \
  > /app/healthcheck.mjs \
 && chown repro:repro /app/healthcheck.mjs

USER repro

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
# Point the /sdk/repro.iife.js route at the bundle we copied above.
ENV SDK_PATH=/app/sdk/repro.iife.js
EXPOSE 3000

# Default: start the Nuxt server. Override in compose for the migrator service:
#   command: ["bunx", "drizzle-kit", "migrate"]
CMD ["bun", ".output/server/index.mjs"]
