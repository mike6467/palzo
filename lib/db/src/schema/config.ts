import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletConfigTable = pgTable("wallet_config", {
  id: integer("id").primaryKey().default(1),
  sourceAddress: text("source_address"),
  destinationAddress: text("destination_address"),
  secretKey: text("secret_key"),
  pollIntervalSeconds: integer("poll_interval_seconds").default(30).notNull(),
  isConfigured: boolean("is_configured").default(false).notNull(),
});

export const insertWalletConfigSchema = createInsertSchema(walletConfigTable).omit({ id: true });
export type InsertWalletConfig = z.infer<typeof insertWalletConfigSchema>;
export type WalletConfig = typeof walletConfigTable.$inferSelect;
