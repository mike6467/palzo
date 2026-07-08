import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletsTable = pgTable("wallets", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  sourceAddress: text("source_address"),
  destinationAddress: text("destination_address"),
  secretKey: text("secret_key"),
  pollIntervalSeconds: integer("poll_interval_seconds").default(30).notNull(),
  isConfigured: boolean("is_configured").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({ id: true, createdAt: true });
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof walletsTable.$inferSelect;
