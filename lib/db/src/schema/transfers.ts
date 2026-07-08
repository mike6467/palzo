import { pgTable, text, serial, integer, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transfersTable = pgTable("transfers", {
  id: serial("id").primaryKey(),
  incomingTxHash: text("incoming_tx_hash").notNull().unique(),
  outgoingTxHash: text("outgoing_tx_hash"),
  amount: numeric("amount", { precision: 20, scale: 7 }).notNull(),
  fromAddress: text("from_address"),
  status: text("status", { enum: ["pending", "forwarded", "failed"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  forwardedAt: timestamp("forwarded_at"),
});

export const insertTransferSchema = createInsertSchema(transfersTable).omit({ id: true, createdAt: true });
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfersTable.$inferSelect;
