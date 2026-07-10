ALTER TABLE "wallets" ALTER COLUMN "poll_interval_seconds" SET DEFAULT 1;
--> statement-breakpoint
UPDATE "wallets" SET "poll_interval_seconds" = 1 WHERE "poll_interval_seconds" >= 3;
