import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// This module gets bundled (esbuild) into each service's own dist/ output, so its
// on-disk location varies by consumer and can't be used directly to find
// lib/db/migrations. Instead, walk up from wherever we're running to find the
// workspace root (marked by pnpm-workspace.yaml), which is stable regardless of
// process.cwd() or bundling.
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate workspace root (pnpm-workspace.yaml) starting from ${startDir}`,
      );
    }
    dir = parent;
  }
}

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Run SQL migrations directly via pg — no drizzle-kit or CREATE SCHEMA needed.
 * Tracks applied migrations in a plain table inside the public schema.
 * Safe to call on every startup.
 */
export async function runMigrations(): Promise<void> {
  // Resolve from the workspace root, not process.cwd() or this module's bundled
  // location — both vary depending on how/where the process was launched.
  const migrationsFolder = path.join(findWorkspaceRoot(moduleDir), "lib/db/migrations");
  const client = await pool.connect();

  try {
    // Migration tracking table lives in public schema — no CREATE SCHEMA required
    await client.query(`
      CREATE TABLE IF NOT EXISTS __migrations (
        id        serial PRIMARY KEY,
        tag       text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Read the journal to get ordered list of migrations
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };

    for (const entry of journal.entries) {
      const { tag } = entry;

      // Skip if already applied
      const { rows } = await client.query(
        "SELECT id FROM __migrations WHERE tag = $1",
        [tag],
      );
      if (rows.length > 0) continue;

      const sql = fs.readFileSync(
        path.join(migrationsFolder, `${tag}.sql`),
        "utf8",
      );

      // Drizzle separates statements with this marker
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await client.query(statement);
      }

      await client.query("INSERT INTO __migrations (tag) VALUES ($1)", [tag]);
    }
  } finally {
    client.release();
  }
}

export * from "./schema";
