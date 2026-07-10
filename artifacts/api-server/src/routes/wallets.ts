import { Router, type IRouter } from "express";
import { Keypair } from "stellar-sdk";
import { db, walletsTable, transfersTable, lockedBalancesTable } from "@workspace/db";
import {
  CreateWalletBody,
  UpdateWalletBody,
  GetWalletParams,
  UpdateWalletParams,
  DeleteWalletParams,
  StartWalletMonitorParams,
  StopWalletMonitorParams,
  ListWalletsResponse,
  CreateWalletResponse,
  GetWalletResponse,
  UpdateWalletResponse,
  GetMonitorSummaryResponse,
  StartWalletMonitorResponse,
  StopWalletMonitorResponse,
  GetLockedBalancesResponse,
  ListLockedBalancesResponse,
  GetLockedBalanceSummaryResponse,
} from "@workspace/api-zod";
import { eq, count, sum, desc } from "drizzle-orm";
import {
  startWalletMonitor,
  stopWalletMonitor,
  getWalletMonitorState,
  fetchWalletBalance,
  stopAllLockedBalanceTrackingForWallet,
  getLockedBalancesForWallet,
} from "../lib/monitor";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getWalletStats(walletId: number) {
  const rows = await db
    .select({ status: transfersTable.status, cnt: count(), total: sum(transfersTable.amount) })
    .from(transfersTable)
    .where(eq(transfersTable.walletId, walletId))
    .groupBy(transfersTable.status);

  let totalForwarded = 0;
  let transferCount = 0;
  for (const row of rows) {
    transferCount += Number(row.cnt);
    if (row.status === "forwarded") totalForwarded += Number(row.total ?? 0);
  }
  return { totalForwarded: totalForwarded.toFixed(7), transferCount };
}

function buildWalletResponse(
  wallet: typeof walletsTable.$inferSelect,
  monitorState: ReturnType<typeof getWalletMonitorState>,
  stats: { totalForwarded: string; transferCount: number },
  currentBalance?: string
) {
  return {
    id: wallet.id,
    label: wallet.label,
    sourceAddress: wallet.sourceAddress ?? null,
    destinationAddress: wallet.destinationAddress ?? null,
    isConfigured: !!(wallet.sourceAddress && wallet.destinationAddress && wallet.secretKey),
    hasSecretKey: !!wallet.secretKey,
    hasSponsorKey: !!wallet.sponsorSecretKey,
    pollIntervalSeconds: wallet.pollIntervalSeconds,
    monitorRunning: monitorState.running,
    lastCheckedAt: monitorState.lastCheckedAt ? monitorState.lastCheckedAt.toISOString() : null,
    lastError: monitorState.lastError ?? null,
    createdAt: wallet.createdAt.toISOString(),
    totalForwarded: stats.totalForwarded,
    transferCount: stats.transferCount,
    currentBalance: currentBalance ?? null,
  };
}

router.get("/wallets", async (_req, res): Promise<void> => {
  const wallets = await db.select().from(walletsTable).orderBy(walletsTable.createdAt);
  const results = await Promise.all(
    wallets.map(async (w) => {
      const [state, stats] = await Promise.all([
        getWalletMonitorState(w.id),
        getWalletStats(w.id),
      ]);
      return buildWalletResponse(w, state, stats);
    })
  );
  res.json(ListWalletsResponse.parse(results));
});

router.post("/wallets", async (req, res): Promise<void> => {
  const parsed = CreateWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { label, secretKey, destinationAddress, sponsorSecretKey } = parsed.data;

  if (sponsorSecretKey) {
    try {
      Keypair.fromSecret(sponsorSecretKey);
    } catch {
      res.status(400).json({ error: "Invalid sponsor secret key. Please provide a valid Pi/Stellar secret key (starts with 'S')." });
      return;
    }
  }

  // Derive the source address from the secret key
  let sourceAddress: string;
  try {
    sourceAddress = Keypair.fromSecret(secretKey).publicKey();
  } catch {
    res.status(400).json({ error: "Invalid secret key. Please provide a valid Pi/Stellar secret key (starts with 'S')." });
    return;
  }

  // Fetch the current balance to confirm the wallet is reachable and show the user
  let currentBalance = "0.0000000";
  try {
    const bal = await fetchWalletBalance(sourceAddress);
    currentBalance = bal.toFixed(7);
  } catch (err) {
    logger.warn({ err, sourceAddress }, "Could not fetch balance during wallet creation — continuing anyway");
  }

  // Auto-generate label from address if not provided
  const walletLabel = label?.trim() || `${sourceAddress.slice(0, 6)}…${sourceAddress.slice(-4)}`;

  const [wallet] = await db
    .insert(walletsTable)
    .values({
      label: walletLabel,
      sourceAddress,
      destinationAddress,
      secretKey,
      sponsorSecretKey: sponsorSecretKey || null,
      pollIntervalSeconds: 3, // poll every 3s for near-instant forwarding
      isConfigured: true,
    })
    .returning();

  // Auto-start monitoring immediately after creation
  try {
    await startWalletMonitor(wallet.id);
    logger.info({ walletId: wallet.id }, "Monitor auto-started after wallet creation");
  } catch (err) {
    logger.warn({ err, walletId: wallet.id }, "Could not auto-start monitor after creation");
  }

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.status(201).json(CreateWalletResponse.parse(buildWalletResponse(wallet, state, stats, currentBalance)));
});

router.get("/wallets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetWalletParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.json(GetWalletResponse.parse(buildWalletResponse(wallet, state, stats)));
});

router.put("/wallets/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateWalletParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateWalletBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Wallet not found" }); return; }

  const updates: Partial<typeof walletsTable.$inferInsert> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.destinationAddress !== undefined) updates.destinationAddress = parsed.data.destinationAddress;
  if (parsed.data.sponsorSecretKey !== undefined) {
    if (parsed.data.sponsorSecretKey) {
      try {
        Keypair.fromSecret(parsed.data.sponsorSecretKey);
      } catch {
        res.status(400).json({ error: "Invalid sponsor secret key. Please provide a valid Pi/Stellar secret key (starts with 'S')." });
        return;
      }
    }
    updates.sponsorSecretKey = parsed.data.sponsorSecretKey || null;
  }

  // If a new secret key is provided, re-derive the source address from it
  let currentBalance: string | undefined;
  if (parsed.data.secretKey) {
    let newSourceAddress: string;
    try {
      newSourceAddress = Keypair.fromSecret(parsed.data.secretKey).publicKey();
    } catch {
      res.status(400).json({ error: "Invalid secret key. Please provide a valid Pi/Stellar secret key (starts with 'S')." });
      return;
    }
    updates.secretKey = parsed.data.secretKey;
    updates.sourceAddress = newSourceAddress;

    // Fetch updated balance for the new source address
    try {
      const bal = await fetchWalletBalance(newSourceAddress);
      currentBalance = bal.toFixed(7);
    } catch (err) {
      logger.warn({ err, newSourceAddress }, "Could not fetch balance after key update");
    }
  }

  const [wallet] = await db.update(walletsTable).set(updates).where(eq(walletsTable.id, params.data.id)).returning();
  const isConfigured = !!(wallet.sourceAddress && wallet.destinationAddress && wallet.secretKey);
  await db.update(walletsTable).set({ isConfigured }).where(eq(walletsTable.id, wallet.id));
  wallet.isConfigured = isConfigured;

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.json(UpdateWalletResponse.parse(buildWalletResponse(wallet, state, stats, currentBalance)));
});

router.delete("/wallets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteWalletParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  stopWalletMonitor(params.data.id);
  await stopAllLockedBalanceTrackingForWallet(params.data.id);
  const [deleted] = await db.delete(walletsTable).where(eq(walletsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Wallet not found" }); return; }

  res.sendStatus(204);
});

router.get("/wallets/:id/locked-balances", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid wallet id" }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  const records = await getLockedBalancesForWallet(id);
  res.json(
    GetLockedBalancesResponse.parse(
      records.map((r) => ({
        id: r.id,
        walletId: r.walletId,
        balanceId: r.balanceId,
        amount: r.amount.toString(),
        unlockAt: r.unlockAt ? r.unlockAt.toISOString() : null,
        status: r.status,
        claimTxHash: r.claimTxHash ?? null,
        errorMessage: r.errorMessage ?? null,
        createdAt: r.createdAt.toISOString(),
        claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
        walletLabel: wallet.label,
      }))
    )
  );
});

// Cross-wallet locked balance monitoring — distinct from the incoming-payment
// forwarding wallets list: this tracks Pi lockups (claimable balances) and
// their unlock/claim lifecycle, separately from ordinary incoming transfers.
router.get("/locked-balances", async (_req, res): Promise<void> => {
  const wallets = await db.select().from(walletsTable);
  const walletLabelById = new Map(wallets.map((w) => [w.id, w.label]));

  const records = await db
    .select()
    .from(lockedBalancesTable)
    .orderBy(desc(lockedBalancesTable.createdAt));

  res.json(
    ListLockedBalancesResponse.parse(
      records.map((r) => ({
        id: r.id,
        walletId: r.walletId,
        balanceId: r.balanceId,
        amount: r.amount.toString(),
        unlockAt: r.unlockAt ? r.unlockAt.toISOString() : null,
        status: r.status,
        claimTxHash: r.claimTxHash ?? null,
        errorMessage: r.errorMessage ?? null,
        createdAt: r.createdAt.toISOString(),
        claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
        walletLabel: walletLabelById.get(r.walletId) ?? null,
      }))
    )
  );
});

router.get("/monitor/locked-summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ status: lockedBalancesTable.status, cnt: count(), total: sum(lockedBalancesTable.amount) })
    .from(lockedBalancesTable)
    .groupBy(lockedBalancesTable.status);

  let monitoringCount = 0;
  let claimingCount = 0;
  let claimedCount = 0;
  let failedCount = 0;
  let expiredCount = 0;
  let totalPendingAmount = 0;
  let totalClaimedAmount = 0;

  for (const row of rows) {
    const c = Number(row.cnt);
    const t = Number(row.total ?? 0);
    if (row.status === "monitoring") { monitoringCount = c; totalPendingAmount += t; }
    else if (row.status === "claiming") { claimingCount = c; totalPendingAmount += t; }
    else if (row.status === "claimed") { claimedCount = c; totalClaimedAmount += t; }
    else if (row.status === "failed") failedCount = c;
    else if (row.status === "expired") expiredCount = c;
  }

  res.json(
    GetLockedBalanceSummaryResponse.parse({
      monitoringCount,
      claimingCount,
      claimedCount,
      failedCount,
      expiredCount,
      totalPendingAmount: totalPendingAmount.toFixed(7),
      totalClaimedAmount: totalClaimedAmount.toFixed(7),
    })
  );
});

router.post("/wallets/:id/start", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = StartWalletMonitorParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  try {
    await startWalletMonitor(params.data.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
    return;
  }

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.json(StartWalletMonitorResponse.parse(buildWalletResponse(wallet, state, stats)));
});

router.post("/wallets/:id/stop", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = StopWalletMonitorParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, params.data.id));
  if (!wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

  stopWalletMonitor(params.data.id);

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.json(StopWalletMonitorResponse.parse(buildWalletResponse(wallet, state, stats)));
});

router.get("/monitor/summary", async (_req, res): Promise<void> => {
  const wallets = await db.select().from(walletsTable);

  const statRows = await db
    .select({ status: transfersTable.status, cnt: count(), total: sum(transfersTable.amount) })
    .from(transfersTable)
    .groupBy(transfersTable.status);

  let runningWallets = 0;
  for (const w of wallets) {
    const s = getWalletMonitorState(w.id);
    if (s.running) runningWallets++;
  }

  let totalPiForwarded = 0;
  let totalTransactions = 0;
  let successCount = 0;
  let failedCount = 0;
  for (const row of statRows) {
    const c = Number(row.cnt);
    totalTransactions += c;
    if (row.status === "forwarded") { successCount = c; totalPiForwarded += Number(row.total ?? 0); }
    else if (row.status === "failed") failedCount = c;
  }

  res.json(
    GetMonitorSummaryResponse.parse({
      totalWallets: wallets.length,
      runningWallets,
      totalPiForwarded: totalPiForwarded.toFixed(7),
      totalTransactions,
      successCount,
      failedCount,
    })
  );
});

export default router;
