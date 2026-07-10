---
name: drizzle-kit generate quirk
description: drizzle-kit generate failed with a malformed path in this project; migrations were hand-written as a fallback.
---

Running `npx drizzle-kit generate --config ./drizzle.config.ts` from `lib/db/` failed with `ENOENT` on a garbled path (`.//home/runner/workspace/lib/db/migrations/meta/0000_snapshot.json` — a relative `./` concatenated onto an absolute path), even though the referenced snapshot file existed.

**Why:** Root cause not fully diagnosed (looks like a drizzle-kit path-join bug when `out`/schema paths in `drizzle.config.ts` are absolute via `path.join(__dirname, ...)`). Not worth deep-diving for a single migration.

**How to apply:** If `drizzle-kit generate` fails this way again, hand-write the migration SQL (matching the existing `migrations/*.sql` style) and add a matching entry to `migrations/meta/_journal.json` instead of fighting the generator. Prefer idempotent SQL (`IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$;` for constraints) since `drizzle-kit push` may have already applied the same change directly to the dev DB before the migration file existed.
