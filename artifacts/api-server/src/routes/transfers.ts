import { Router, type IRouter } from "express";
import { db, transfersTable, walletsTable } from "@workspace/db";
import {
  ListTransfersQueryParams,
  GetTransferParams,
  ListTransfersResponse,
  GetTransferStatsResponse,
  GetTransferResponse,
} from "@workspace/api-zod";
import { desc, count, sum, eq } from "drizzle-orm";

const router: IRouter = Router();

function serializeTransfer(t: typeof transfersTable.$inferSelect & { walletLabel?: string | null }) {
  return {
    id: t.id,
    walletId: t.walletId,
    walletLabel: t.walletLabel ?? null,
    incomingTxHash: t.incomingTxHash,
    outgoingTxHash: t.outgoingTxHash ?? null,
    amount: t.amount?.toString() ?? "0",
    fromAddress: t.fromAddress ?? null,
    status: t.status,
    errorMessage: t.errorMessage ?? null,
    createdAt: t.createdAt.toISOString(),
    forwardedAt: t.forwardedAt ? t.forwardedAt.toISOString() : null,
  };
}

router.get("/transfers", async (req, res): Promise<void> => {
  const qp = ListTransfersQueryParams.safeParse(req.query);
  const limit = qp.success ? (qp.data.limit ?? 50) : 50;
  const offset = qp.success ? (qp.data.offset ?? 0) : 0;
  const walletId = qp.success ? qp.data.walletId : undefined;

  const baseQuery = db
    .select({
      id: transfersTable.id,
      walletId: transfersTable.walletId,
      walletLabel: walletsTable.label,
      incomingTxHash: transfersTable.incomingTxHash,
      outgoingTxHash: transfersTable.outgoingTxHash,
      amount: transfersTable.amount,
      fromAddress: transfersTable.fromAddress,
      status: transfersTable.status,
      errorMessage: transfersTable.errorMessage,
      createdAt: transfersTable.createdAt,
      forwardedAt: transfersTable.forwardedAt,
    })
    .from(transfersTable)
    .leftJoin(walletsTable, eq(transfersTable.walletId, walletsTable.id));

  const countQuery = db.select({ total: count() }).from(transfersTable);

  let rows, totalResult;
  if (walletId !== undefined) {
    [totalResult, rows] = await Promise.all([
      countQuery.where(eq(transfersTable.walletId, walletId)),
      baseQuery.where(eq(transfersTable.walletId, walletId)).orderBy(desc(transfersTable.createdAt)).limit(limit).offset(offset),
    ]);
  } else {
    [totalResult, rows] = await Promise.all([
      countQuery,
      baseQuery.orderBy(desc(transfersTable.createdAt)).limit(limit).offset(offset),
    ]);
  }

  res.json(
    ListTransfersResponse.parse({
      transfers: rows.map(serializeTransfer),
      total: totalResult[0]?.total ?? 0,
    })
  );
});

router.get("/transfers/stats", async (_req, res): Promise<void> => {
  const [allStats, recentRows] = await Promise.all([
    db
      .select({ status: transfersTable.status, cnt: count(), total: sum(transfersTable.amount) })
      .from(transfersTable)
      .groupBy(transfersTable.status),
    db
      .select({
        id: transfersTable.id,
        walletId: transfersTable.walletId,
        walletLabel: walletsTable.label,
        incomingTxHash: transfersTable.incomingTxHash,
        outgoingTxHash: transfersTable.outgoingTxHash,
        amount: transfersTable.amount,
        fromAddress: transfersTable.fromAddress,
        status: transfersTable.status,
        errorMessage: transfersTable.errorMessage,
        createdAt: transfersTable.createdAt,
        forwardedAt: transfersTable.forwardedAt,
      })
      .from(transfersTable)
      .leftJoin(walletsTable, eq(transfersTable.walletId, walletsTable.id))
      .orderBy(desc(transfersTable.createdAt))
      .limit(5),
  ]);

  let successCount = 0, failedCount = 0, pendingCount = 0, totalPiForwarded = 0;
  for (const row of allStats) {
    const c = Number(row.cnt);
    const t = Number(row.total ?? 0);
    if (row.status === "forwarded") { successCount = c; totalPiForwarded += t; }
    else if (row.status === "failed") failedCount = c;
    else if (row.status === "pending") pendingCount = c;
  }

  res.json(
    GetTransferStatsResponse.parse({
      totalPiForwarded: totalPiForwarded.toFixed(7),
      totalTransactions: successCount + failedCount + pendingCount,
      successCount,
      failedCount,
      pendingCount,
      recentTransfers: recentRows.map(serializeTransfer),
    })
  );
});

router.get("/transfers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetTransferParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [row] = await db
    .select({
      id: transfersTable.id,
      walletId: transfersTable.walletId,
      walletLabel: walletsTable.label,
      incomingTxHash: transfersTable.incomingTxHash,
      outgoingTxHash: transfersTable.outgoingTxHash,
      amount: transfersTable.amount,
      fromAddress: transfersTable.fromAddress,
      status: transfersTable.status,
      errorMessage: transfersTable.errorMessage,
      createdAt: transfersTable.createdAt,
      forwardedAt: transfersTable.forwardedAt,
    })
    .from(transfersTable)
    .leftJoin(walletsTable, eq(transfersTable.walletId, walletsTable.id))
    .where(eq(transfersTable.id, params.data.id));

  if (!row) { res.status(404).json({ error: "Transfer not found" }); return; }

  res.json(GetTransferResponse.parse(serializeTransfer(row)));
});

export default router;
