ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "sponsor_secret_key" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locked_balances" (
"id" serial PRIMARY KEY NOT NULL,
"wallet_id" integer NOT NULL,
"balance_id" text NOT NULL,
"amount" numeric(20, 7) NOT NULL,
"unlock_at" timestamp,
"status" text DEFAULT 'monitoring' NOT NULL,
"claim_tx_hash" text,
"error_message" text,
"created_at" timestamp DEFAULT now() NOT NULL,
"claimed_at" timestamp,
CONSTRAINT "locked_balances_balance_id_unique" UNIQUE("balance_id")
);
--> statement-breakpoint
DO $ BEGIN
  ALTER TABLE "locked_balances" ADD CONSTRAINT "locked_balances_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $;
