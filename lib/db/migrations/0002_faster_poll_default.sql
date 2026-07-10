ALTER TABLE "wallets" ALTER COLUMN "poll_interval_seconds" SET DEFAULT 3;
--> statement-breakpoint
UPDATE "wallets" SET "poll_interval_seconds" = 3 WHERE "poll_interval_seconds" >= 5;
