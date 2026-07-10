# PiOps — Pi Wallet Auto-Forwarder

A dashboard for monitoring Pi Network wallets and automatically forwarding incoming funds to a destination address.

## Run & Operate

- **Frontend**: workflow `artifacts/pi-forwarder: web` — React/Vite dev server (auto-started)
- **API**: workflow `artifacts/api-server: API Server` — Express 5 server (auto-started)
- `pnpm install` — install all workspace dependencies
- `pnpm --filter @workspace/db run push` — push DB schema changes to dev database
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `DATABASE_URL` is runtime-managed by Replit — no manual setup needed

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/lib/monitor.ts` — wallet balance polling, incoming-payment forwarding, and locked-balance (claimable balance) detection/claim/forward logic all live here.
- `lib/db/src/schema/lockedBalances.ts` — tracks each detected locked (claimable) balance through `monitoring → claiming → claimed/failed/expired`.
- `lib/api-spec/openapi.yaml` — source of truth for all API contracts; edit this then run codegen, never hand-edit `lib/api-zod`/`lib/api-client-react` generated output.

## Architecture decisions

- Locked Pi balances are Stellar/Pi Horizon "claimable balances" with a time predicate (`not_before`/`abs_before`) gating when the source wallet's own claimant entry becomes claimable.
- Locked balances get their own high-frequency polling state machine, separate from the regular per-wallet interval poller: >30s to unlock → poll every 15s, ≤30s → every 500ms, ≤3s → every 100ms, at/after unlock → immediate claim with fast retry. This guarantees the claim fires within ~100ms of unlock instead of missing the window on a slow interval.
- An optional per-wallet `sponsorSecretKey` lets a separate wallet pay the network fee for claim+forward transactions, via a CAP-15 fee-bump transaction (inner tx signed by the source wallet, outer fee-bump signed by the sponsor). Without a sponsor key, the source wallet pays its own fee as before.
- Regular incoming-payment forwarding still reserves 1.02π; locked-balance claim+forward does not need the reserve hold (the network reserve is already satisfied by the existing balance) — it only subtracts a small fee buffer.

## Product

- Dashboard for monitoring Pi Network wallets: tracks incoming payments and forwards them to a destination address automatically.
- Detects Pi lockups (time-locked/claimable balances) on monitored wallets and automatically claims + forwards them the instant they unlock, optionally using a separate sponsor wallet to pay the transaction fee.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
