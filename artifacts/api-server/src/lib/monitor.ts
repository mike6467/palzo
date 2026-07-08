import { Keypair, Horizon, TransactionBuilder, Operation, Asset } from "stellar-sdk";
import { db, walletsTable, transfersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

const PI_NETWORK_PASSPHRASE = "Pi Network";
const PI_HORIZON_URL = "https://api.mainnet.minepi.com";

interface WalletMonitorState {
  running: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  intervalHandle: NodeJS.Timeout | null;
  seenTxHashes: Set<string>;
}

const states = new Map<number, WalletMonitorState>();

function getOrCreateState(walletId: number): WalletMonitorState {
  if (!states.has(walletId)) {
    states.set(walletId, {
      running: false,
      lastCheckedAt: null,
      lastError: null,
      intervalHandle: null,
      seenTxHashes: new Set(),
    });
  }
  return states.get(walletId)!;
}

export function getWalletMonitorState(walletId: number) {
  const s = states.get(walletId);
  return {
    running: s?.running ?? false,
    lastCheckedAt: s?.lastCheckedAt ?? null,
    lastError: s?.lastError ?? null,
  };
}

export function getAllRunningWalletIds(): number[] {
  return Array.from(states.entries())
    .filter(([, s]) => s.running)
    .map(([id]) => id);
}

// Derive the public key (source address) from a Stellar/Pi secret key.
export function derivePublicKey(secretKey: string): string {
  return Keypair.fromSecret(secretKey).publicKey();
}

// Pi Network reserve rules:
//   1.00 Pi  — base network reserve (permanently locked, required by Stellar protocol)
//   0.02 Pi  — fee buffer kept in wallet to cover transaction fees
//   -------
//   1.02 Pi  total minimum balance that must remain in every source wallet at all times
const NETWORK_RESERVE_PI = 1.0;
const FEE_BUFFER_PI = 0.02;
const TOTAL_HOLD_PI = NETWORK_RESERVE_PI + FEE_BUFFER_PI; // 1.02 Pi

interface PiTransaction {
  id: string;
  type: string;
  // payment fields
  from?: string;
  to?: string;
  amount?: string;
  // create_account fields (also sends Pi)
  funder?: string;
  account?: string;
  starting_balance?: string;
}

interface PiAccountBalance {
  asset_type: string;
  balance: string;
}

interface PiAccount {
  balances: PiAccountBalance[];
}

export async function fetchWalletBalance(address: string): Promise<number> {
  const resp = await fetch(`${PI_HORIZON_URL}/accounts/${address}`, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch wallet balance: ${resp.status} ${resp.statusText}`);
  }
  const account = (await resp.json()) as PiAccount;
  const native = account.balances?.find((b) => b.asset_type === "native");
  return native ? parseFloat(native.balance) : 0;
}

async function forwardPi(
  sourceAddress: string,
  destinationAddress: string,
  secretKey: string,
  amount: string
): Promise<string> {
  logger.info({ sourceAddress, destinationAddress, amount }, "Submitting Pi forward transaction");

  const server = new Horizon.Server(PI_HORIZON_URL, { allowHttp: false });
  const keypair = Keypair.fromSecret(secretKey);

  const account = await server.loadAccount(sourceAddress);
  const fee = await server.fetchBaseFee();

  const tx = new TransactionBuilder(account, {
    fee: fee.toString(),
    networkPassphrase: PI_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: destinationAddress,
        asset: Asset.native(),
        amount: amount,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  const result = await server.submitTransaction(tx);
  return result.hash;
}

async function pollWallet(walletId: number) {
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  const state = getOrCreateState(walletId);

  if (!wallet || !wallet.sourceAddress || !wallet.destinationAddress || !wallet.secretKey) {
    state.lastError = "Wallet not fully configured";
    return;
  }

  state.lastCheckedAt = new Date();

  try {
    // Use the /payments endpoint (Horizon operations feed) — NOT /transactions.
    // /transactions returns full transaction envelopes which have a different structure
    // and do NOT contain the type/from/to/amount fields we need.
    // /payments returns individual payment operations with the correct fields.
    // order=desc ensures the newest payments are checked first.
    const url = `${PI_HORIZON_URL}/accounts/${wallet.sourceAddress}/payments?limit=20&order=desc`;
    logger.info({ walletId, url }, "Polling Pi payments");
    const resp = await fetch(url, { headers: { Accept: "application/json" } });

    if (!resp.ok) {
      state.lastError = `Pi API error: ${resp.status} ${resp.statusText}`;
      logger.warn({ walletId, status: resp.status, statusText: resp.statusText }, "Pi API returned error");
      return;
    }

    const data = (await resp.json()) as { _embedded?: { records?: PiTransaction[] } };
    const records: PiTransaction[] = data?._embedded?.records ?? [];
    logger.info({ walletId, recordCount: records.length }, "Payments fetched");

    for (const tx of records) {
      if (!tx.id || state.seenTxHashes.has(tx.id)) continue;

      // Normalize across payment types:
      // - "payment": from/to/amount fields
      // - "create_account": funder/account/starting_balance fields
      let sender: string | undefined;
      let recipient: string | undefined;
      let receivedAmount: string | undefined;

      if (tx.type === "payment") {
        sender = tx.from;
        recipient = tx.to;
        receivedAmount = tx.amount;
      } else if (tx.type === "create_account") {
        sender = tx.funder;
        recipient = tx.account;
        receivedAmount = tx.starting_balance;
      }

      const isIncoming =
        !!recipient &&
        recipient === wallet.sourceAddress &&
        sender !== wallet.sourceAddress;

      if (!isIncoming) {
        state.seenTxHashes.add(tx.id);
        continue;
      }

      const existing = await db
        .select()
        .from(transfersTable)
        .where(and(eq(transfersTable.walletId, walletId), eq(transfersTable.incomingTxHash, tx.id)));

      if (existing.length > 0) {
        state.seenTxHashes.add(tx.id);
        continue;
      }

      logger.info({ walletId, txId: tx.id, type: tx.type, amount: receivedAmount }, "Detected incoming Pi, calculating forwardable amount");
      state.seenTxHashes.add(tx.id);

      // Fetch live balance to calculate exactly how much can be forwarded
      // after leaving the required reserve in the wallet.
      let currentBalance: number;
      try {
        currentBalance = await fetchWalletBalance(wallet.sourceAddress);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = `Balance fetch failed: ${msg}`;
        logger.error({ err, walletId, txId: tx.id }, "Could not fetch wallet balance");
        continue;
      }

      // forwardable = balance − 1.02 Pi (1 Pi reserve + 0.02 Pi fee buffer)
      const forwardableAmount = parseFloat((currentBalance - TOTAL_HOLD_PI).toFixed(7));

      if (forwardableAmount <= 0) {
        logger.info(
          { walletId, txId: tx.id, currentBalance, totalHold: TOTAL_HOLD_PI },
          "Insufficient balance to forward after reserve — skipping"
        );
        state.lastError = `Balance ${currentBalance} π is below reserve threshold (${TOTAL_HOLD_PI} π required). No Pi forwarded.`;
        continue;
      }

      logger.info(
        { walletId, txId: tx.id, currentBalance, forwardableAmount, totalHold: TOTAL_HOLD_PI },
        "Forwarding Pi after reserve deduction"
      );

      const [record] = await db
        .insert(transfersTable)
        .values({
          walletId,
          incomingTxHash: tx.id,
          amount: forwardableAmount.toFixed(7),
          fromAddress: sender ?? null,
          status: "pending",
        })
        .returning();

      try {
        const outTxHash = await forwardPi(
          wallet.sourceAddress,
          wallet.destinationAddress,
          wallet.secretKey,
          forwardableAmount.toFixed(7)
        );

        await db
          .update(transfersTable)
          .set({ status: "forwarded", outgoingTxHash: outTxHash, forwardedAt: new Date() })
          .where(eq(transfersTable.id, record.id));

        state.lastError = null;
        logger.info(
          { walletId, txId: tx.id, outTxHash, forwardedAmount: forwardableAmount },
          "Successfully forwarded Pi"
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(transfersTable)
          .set({ status: "failed", errorMessage: msg })
          .where(eq(transfersTable.id, record.id));
        state.lastError = `Forward failed: ${msg}`;
        logger.error({ err, walletId, txId: tx.id }, "Failed to forward Pi");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastError = `Poll error: ${msg}`;
    logger.error({ err, walletId }, "Monitor poll error");
  }
}

export async function startWalletMonitor(walletId: number): Promise<void> {
  const state = getOrCreateState(walletId);
  if (state.running) return;

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  if (!wallet?.sourceAddress || !wallet?.destinationAddress || !wallet?.secretKey) {
    throw new Error("Wallet not fully configured. Please set the source address, destination address, and secret key first.");
  }

  state.running = true;
  state.lastError = null;

  const intervalMs = (wallet.pollIntervalSeconds ?? 10) * 1000;

  await pollWallet(walletId);
  state.intervalHandle = setInterval(() => {
    pollWallet(walletId).catch((err) => {
      logger.error({ err, walletId }, "Unhandled monitor error");
    });
  }, intervalMs);

  logger.info({ walletId, intervalMs }, "Wallet monitor started");
}

export function stopWalletMonitor(walletId: number): void {
  const state = states.get(walletId);
  if (!state?.running) return;

  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  logger.info({ walletId }, "Wallet monitor stopped");
}
