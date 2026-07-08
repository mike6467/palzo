import { db, walletConfigTable, transfersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

interface MonitorState {
  running: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  intervalHandle: NodeJS.Timeout | null;
  seenTxHashes: Set<string>;
}

const state: MonitorState = {
  running: false,
  lastCheckedAt: null,
  lastError: null,
  intervalHandle: null,
  seenTxHashes: new Set(),
};

export function getMonitorState() {
  return {
    running: state.running,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
  };
}

async function getConfig() {
  const [cfg] = await db.select().from(walletConfigTable).where(eq(walletConfigTable.id, 1));
  return cfg ?? null;
}

async function pollAndForward() {
  const cfg = await getConfig();
  if (!cfg || !cfg.sourceAddress || !cfg.destinationAddress || !cfg.secretKey) {
    state.lastError = "Wallet not fully configured";
    return;
  }

  state.lastCheckedAt = new Date();

  try {
    const url = `https://api.mainnet.minepi.com/accounts/${cfg.sourceAddress}/transactions?limit=10`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });

    if (!resp.ok) {
      state.lastError = `Pi API error: ${resp.status} ${resp.statusText}`;
      return;
    }

    const data = (await resp.json()) as { _embedded?: { records?: PiTransaction[] } };
    const records: PiTransaction[] = data?._embedded?.records ?? [];

    for (const tx of records) {
      if (!tx.id || state.seenTxHashes.has(tx.id)) continue;

      const isIncoming =
        tx.type === "payment" &&
        tx.to === cfg.sourceAddress &&
        tx.to !== tx.from;

      if (!isIncoming) {
        state.seenTxHashes.add(tx.id);
        continue;
      }

      const existing = await db
        .select()
        .from(transfersTable)
        .where(eq(transfersTable.incomingTxHash, tx.id));

      if (existing.length > 0) {
        state.seenTxHashes.add(tx.id);
        continue;
      }

      logger.info({ txId: tx.id, amount: tx.amount }, "Detected incoming Pi transfer, recording");

      const [record] = await db
        .insert(transfersTable)
        .values({
          incomingTxHash: tx.id,
          amount: tx.amount ?? "0",
          fromAddress: tx.from ?? null,
          status: "pending",
        })
        .returning();

      state.seenTxHashes.add(tx.id);

      try {
        const outTxHash = await forwardPi(
          cfg.sourceAddress,
          cfg.destinationAddress,
          cfg.secretKey,
          tx.amount ?? "0"
        );

        await db
          .update(transfersTable)
          .set({ status: "forwarded", outgoingTxHash: outTxHash, forwardedAt: new Date() })
          .where(eq(transfersTable.id, record.id));

        state.lastError = null;
        logger.info({ txId: tx.id, outTxHash }, "Successfully forwarded Pi");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(transfersTable)
          .set({ status: "failed", errorMessage: msg })
          .where(eq(transfersTable.id, record.id));
        state.lastError = `Forward failed: ${msg}`;
        logger.error({ err, txId: tx.id }, "Failed to forward Pi");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = `Poll error: ${msg}`;
    logger.error({ err }, "Monitor poll error");
  }
}

interface PiTransaction {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: string;
}

async function forwardPi(
  _sourceAddress: string,
  _destinationAddress: string,
  _secretKey: string,
  _amount: string
): Promise<string> {
  // Pi Network's mainnet SDK/API for signing and submitting transactions.
  // The Pi SDK (pi-stellar-sdk or stellar-sdk) is used to build a payment operation
  // on the Pi blockchain (Pi uses Stellar under the hood).
  // This implementation uses the Stellar SDK pattern as Pi Network is Stellar-based.
  //
  // NOTE: To enable real forwarding, install stellar-sdk:
  //   pnpm --filter @workspace/api-server add stellar-sdk
  // Then replace this stub with actual Stellar payment transaction code.
  //
  // Stub: logs and simulates a successful forward for testing purposes.
  logger.info({ _sourceAddress, _destinationAddress, _amount }, "Forwarding Pi (stub - install stellar-sdk to enable)");
  const stubHash = `stub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return stubHash;
}

export async function startMonitor(): Promise<void> {
  if (state.running) return;

  const cfg = await getConfig();
  if (!cfg?.sourceAddress || !cfg?.destinationAddress || !cfg?.secretKey) {
    throw new Error("Wallet not configured. Please set up source address, destination address, and secret key first.");
  }

  state.running = true;
  state.lastError = null;

  const intervalMs = (cfg.pollIntervalSeconds ?? 30) * 1000;

  await pollAndForward();
  state.intervalHandle = setInterval(() => {
    pollAndForward().catch((err) => {
      logger.error({ err }, "Unhandled monitor error");
    });
  }, intervalMs);

  logger.info({ intervalMs }, "Monitor started");
}

export function stopMonitor(): void {
  if (!state.running) return;

  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  logger.info("Monitor stopped");
}
