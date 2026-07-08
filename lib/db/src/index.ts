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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run SQL migrations from the migrations folder.
 * Safe to call on every startup — drizzle tracks which migrations have run.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, "../migrations");
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
