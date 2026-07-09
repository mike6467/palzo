import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Run SQL migrations from the migrations folder.
 * Safe to call on every startup — drizzle tracks which migrations have run.
 *
 * Uses process.cwd() so the path resolves correctly whether the code is run
 * directly from source or bundled by esbuild into a dist/ directory.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(process.cwd(), "lib/db/migrations");
  // Use public schema for migration tracking — Railway restricts CREATE SCHEMA
  await migrate(db, {
    migrationsFolder,
    migrationsSchema: "public",
    migrationsTable: "__drizzle_migrations",
  });
}

export * from "./schema";
