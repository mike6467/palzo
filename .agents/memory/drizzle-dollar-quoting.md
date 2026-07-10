---
name: drizzle-dollar-quoting
description: Hand-rolled SQL migration runners executing raw pg queries require valid Postgres dollar-quoting in DO blocks.
---

Some projects run Drizzle-generated `.sql` migrations through a custom runner (plain `pg` client executing each `--> statement-breakpoint` chunk) instead of `drizzle-kit migrate`. In that setup, a `DO $ BEGIN ... END $;` block is invalid — Postgres requires matched double dollar-quotes: `DO $$ BEGIN ... END $$;`. A single `$` throws `syntax error at or near "$"` at migration time.

**Why:** seen in a generated migration where drizzle-kit (or a manual edit) emitted single `$` tags; the app refused to start because the custom migration runner has no tolerance for malformed SQL (no ORM-level DO-block templating to catch it).

**How to apply:** when a "Database migration failed" error mentions `syntax error at or near "$"`, grep the migrations folder for `DO $ ` / `END $;` (single dollar) and fix to `$$`.
