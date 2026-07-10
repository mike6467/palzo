import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";
import { resetOrphanedClaimingBalances, resumeAllWalletMonitors } from "./lib/monitor";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run DB migrations before accepting traffic
runMigrations()
  .then(async () => {
    logger.info("Database migrations complete");
    await resetOrphanedClaimingBalances();
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
    await resumeAllWalletMonitors();
  })
  .catch((err) => {
    logger.error({ err }, "Database migration failed — refusing to start");
    process.exit(1);
  });
