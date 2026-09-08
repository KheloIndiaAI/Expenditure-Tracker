# EFIP server image — for AWS App Runner (or any container host).
#
# BUILD CONTEXT = REPO ROOT (so both platform/ and the dashboard HTML are in scope):
#   docker build -f platform/Dockerfile -t efip-server .
#
# Node 22 runs the server's TypeScript directly (type-stripping, no tsc emit).
# Production uses Postgres via DATABASE_URL, so node:sqlite is never loaded.

FROM node:22-slim AS build
WORKDIR /src/platform

# Install workspace deps with the lockfile (cache-friendly: manifests first).
COPY platform/package.json platform/package-lock.json ./
COPY platform/packages/shared/package.json packages/shared/
COPY platform/packages/server/package.json packages/server/
COPY platform/packages/web/package.json packages/web/
RUN npm ci

# Sources for the build (shared lib + login SPA). The dashboard is a separate
# static file (platform/public/index.html) served by the server at runtime.
COPY platform/tsconfig.base.json ./
COPY platform/packages ./packages

# Build @efip/shared and the login SPA (Vite).
RUN npm run build:deploy

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /src/platform
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Chromium, for the Expenditure Summary PDF.
#
# The report is laid out as HTML and printed by a headless browser — that is how
# the desktop tool has always produced it, and reusing the same renderer is what
# keeps the served PDF identical to the one the finance team already knows. The
# alternative was a second layout engine and therefore a second layout.
#
# It is only ever launched when somebody asks for a PDF (see reports/service.ts),
# so on a normal morning this is disk, not memory. --no-sandbox is required
# because the process runs as root here, and --disable-dev-shm-usage because the
# container's /dev/shm is 64MB and Chromium will die part-way through a full page
# without it. Both are passed via CHROME_FLAGS so the vendored code stays
# unchanged and still runs sandboxed on a desktop.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
ENV CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage"

COPY --from=build /src/platform/node_modules ./node_modules
COPY --from=build /src/platform/package.json ./package.json
COPY --from=build /src/platform/packages ./packages
# The single dashboard file the server serves at "/" (main.ts → ../../../public/index.html).
COPY platform/public ./public

EXPOSE 8080
# No --experimental-sqlite: production uses Postgres via DATABASE_URL.
CMD ["node", "--experimental-strip-types", "--no-warnings", "packages/server/src/main.ts"]
