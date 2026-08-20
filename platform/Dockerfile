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

# Sources + the dashboard HTML (sync:dashboard reads ../SAI_Financial_Intelligence.html).
COPY platform/tsconfig.base.json ./
COPY platform/packages ./packages
COPY SAI_Financial_Intelligence.html /src/SAI_Financial_Intelligence.html

# Build @efip/shared, the login SPA, and copy the dashboard into the server.
RUN npm run build:deploy

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /src/platform
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY --from=build /src/platform/node_modules ./node_modules
COPY --from=build /src/platform/package.json ./package.json
COPY --from=build /src/platform/packages ./packages

EXPOSE 8080
# No --experimental-sqlite: production uses Postgres via DATABASE_URL.
CMD ["node", "--experimental-strip-types", "--no-warnings", "packages/server/src/main.ts"]
