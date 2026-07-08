#!/usr/bin/env bash
# Run database schema push (idempotent).
# Usage: bash scripts/migrate.sh
set -euo pipefail

echo "Running database migrations..."
pnpm --filter @workspace/db run push
echo "Migrations complete."
