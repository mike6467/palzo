import { Router, type IRouter } from "express";
import { db, walletsTable, transfersTable } from "@workspace/db";
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
} from "@workspace/api-zod";
import { eq, count, sum } from "drizzle-orm";
import { startWalletMonitor, stopWalletMonitor, getWalletMonitorState } from "../lib/monitor";

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

function buildWalletResponse(wallet: typeof walletsTable.$inferSelect, monitorState: ReturnType<typeof getWalletMonitorState>, stats: { totalForwarded: string; transferCount: number }) {
  return {
    id: wallet.id,
    label: wallet.label,
    sourceAddress: wallet.sourceAddress ?? null,
    destinationAddress: wallet.destinationAddress ?? null,
    isConfigured: !!(wallet.sourceAddress && wallet.destinationAddress && wallet.secretKey),
    hasSecretKey: !!wallet.secretKey,
    pollIntervalSeconds: wallet.pollIntervalSeconds,
    monitorRunning: monitorState.running,
    lastCheckedAt: monitorState.lastCheckedAt ? monitorState.lastCheckedAt.toISOString() : null,
    lastError: monitorState.lastError ?? null,
    createdAt: wallet.createdAt.toISOString(),
    totalForwarded: stats.totalForwarded,
    transferCount: stats.transferCount,
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

  const { label, sourceAddress, destinationAddress, secretKey, pollIntervalSeconds } = parsed.data;
  const isConfigured = !!(sourceAddress && destinationAddress && secretKey);

  const [wallet] = await db
    .insert(walletsTable)
    .values({ label, sourceAddress, destinationAddress, secretKey, pollIntervalSeconds: pollIntervalSeconds ?? 30, isConfigured })
    .returning();

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.status(201).json(CreateWalletResponse.parse(buildWalletResponse(wallet, state, stats)));
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
  if (parsed.data.sourceAddress !== undefined) updates.sourceAddress = parsed.data.sourceAddress;
  if (parsed.data.destinationAddress !== undefined) updates.destinationAddress = parsed.data.destinationAddress;
  if (parsed.data.secretKey !== undefined && parsed.data.secretKey !== null) updates.secretKey = parsed.data.secretKey;
  if (parsed.data.pollIntervalSeconds !== undefined) updates.pollIntervalSeconds = parsed.data.pollIntervalSeconds;

  const [wallet] = await db.update(walletsTable).set(updates).where(eq(walletsTable.id, params.data.id)).returning();
  const isConfigured = !!(wallet.sourceAddress && wallet.destinationAddress && wallet.secretKey);
  await db.update(walletsTable).set({ isConfigured }).where(eq(walletsTable.id, wallet.id));
  wallet.isConfigured = isConfigured;

  const [state, stats] = await Promise.all([getWalletMonitorState(wallet.id), getWalletStats(wallet.id)]);
  res.json(UpdateWalletResponse.parse(buildWalletResponse(wallet, state, stats)));
});

router.delete("/wallets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteWalletParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  stopWalletMonitor(params.data.id);
  const [deleted] = await db.delete(walletsTable).where(eq(walletsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Wallet not found" }); return; }

  res.sendStatus(204);
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
