CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source_address" text,
	"destination_address" text,
	"secret_key" text,
	"poll_interval_seconds" integer DEFAULT 30 NOT NULL,
	"is_configured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"incoming_tx_hash" text NOT NULL,
	"outgoing_tx_hash" text,
	"amount" numeric(20, 7) NOT NULL,
	"from_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"forwarded_at" timestamp,
	CONSTRAINT "transfers_incoming_tx_hash_unique" UNIQUE("incoming_tx_hash")
);
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;