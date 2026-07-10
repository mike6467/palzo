ALTER TABLE "wallets" ALTER COLUMN "poll_interval_seconds" SET DEFAULT 10;
--> statement-breakpoint
UPDATE "wallets" SET "poll_interval_seconds" = 10;
