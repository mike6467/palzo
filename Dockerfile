# ─── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:24-slim AS builder

# Enable pnpm via corepack (matches the version in the lockfile)
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy workspace manifests first so Docker can cache the install layer
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy every package.json so pnpm can resolve the workspace graph
COPY lib/db/package.json                  ./lib/db/
COPY lib/api-spec/package.json            ./lib/api-spec/
COPY lib/api-zod/package.json             ./lib/api-zod/
COPY lib/api-client-react/package.json    ./lib/api-client-react/
COPY scripts/package.json                 ./scripts/
COPY artifacts/api-server/package.json    ./artifacts/api-server/
COPY artifacts/pi-forwarder/package.json  ./artifacts/pi-forwarder/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/

RUN pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Build frontend (BASE_PATH=/ for a root-mounted deployment)
RUN BASE_PATH=/ pnpm --filter @workspace/pi-forwarder run build

# Build API server (esbuild bundles everything into dist/index.mjs)
RUN pnpm --filter @workspace/api-server run build


# ─── Stage 2: production runtime ──────────────────────────────────────────────
FROM node:24-slim AS runner

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy workspace manifests (needed to run pnpm commands for migrations)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy only the db package (drizzle-kit lives there; needed for migrations)
COPY lib/db/ ./lib/db/
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/artifacts/api-server/dist  ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/pi-forwarder/dist/public ./artifacts/pi-forwarder/dist/public

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
