# Single-stage build — keeps pnpm workspace symlinks intact so drizzle-kit
# is available for migrations at runtime.
FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

COPY lib/db/package.json                   ./lib/db/
COPY lib/api-spec/package.json             ./lib/api-spec/
COPY lib/api-zod/package.json              ./lib/api-zod/
COPY lib/api-client-react/package.json     ./lib/api-client-react/
COPY scripts/package.json                  ./scripts/
COPY artifacts/api-server/package.json     ./artifacts/api-server/
COPY artifacts/pi-forwarder/package.json   ./artifacts/pi-forwarder/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/

RUN pnpm install --frozen-lockfile

# Copy the rest of the source
COPY . .

# Build frontend then API server
RUN BASE_PATH=/ pnpm --filter @workspace/pi-forwarder run build
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
