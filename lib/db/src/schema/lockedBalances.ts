import { pgTable, text, serial, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { walletsTable } from "./wallets";

// Tracks Pi "claimable balances" (lockups) detected for a wallet's source address,
// their unlock (not_before) time, and the outcome of the claim+forward attempt that
// fires the instant the lockup unlocks.
export const lockedBalancesTable = pgTable("locked_balances", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").notNull().references(() => walletsTable.id, { onDelete: "cascade" }),
  balanceId: text("balance_id").notNull().unique(),
  amount: numeric("amount", { precision: 20, scale: 7 }).notNull(),
  unlockAt: timestamp("unlock_at"),
  status: text("status", {
    enum: ["monitoring", "claiming", "claimed", "failed", "expired"],
  })
    .notNull()
    .default("monitoring"),
  claimTxHash: text("claim_tx_hash"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  claimedAt: timestamp("claimed_at"),
});

export const insertLockedBalanceSchema = createInsertSchema(lockedBalancesTable).omit({ id: true, createdAt: true });
export type InsertLockedBalance = z.infer<typeof insertLockedBalanceSchema>;
export type LockedBalance = typeof lockedBalancesTable.$inferSelect;
