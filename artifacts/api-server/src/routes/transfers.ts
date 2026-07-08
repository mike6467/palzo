import { Router, type IRouter } from "express";
import { db, transfersTable } from "@workspace/db";
import {
  ListTransfersQueryParams,
  GetTransferParams,
  ListTransfersResponse,
  GetTransferStatsResponse,
  GetTransferResponse,
} from "@workspace/api-zod";
import { desc, count, sum, eq } from "drizzle-orm";

const router: IRouter = Router();

function serializeTransfer(t: typeof transfersTable.$inferSelect) {
  return {
    id: t.id,
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

  const [totalResult, rows] = await Promise.all([
    db.select({ total: count() }).from(transfersTable),
    db.select().from(transfersTable).orderBy(desc(transfersTable.createdAt)).limit(limit).offset(offset),
  ]);

  res.json(
    ListTransfersResponse.parse({
      transfers: rows.map(serializeTransfer),
      total: totalResult[0]?.total ?? 0,
    })
  );
});

router.get("/transfers/stats", async (req, res): Promise<void> => {
  const [allStats, recentRows] = await Promise.all([
    db
      .select({
        status: transfersTable.status,
        cnt: count(),
        total: sum(transfersTable.amount),
      })
      .from(transfersTable)
      .groupBy(transfersTable.status),
    db.select().from(transfersTable).orderBy(desc(transfersTable.createdAt)).limit(5),
  ]);

  let successCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  let totalPiForwarded = 0;

  for (const row of allStats) {
    const c = Number(row.cnt);
    const t = Number(row.total ?? 0);
    if (row.status === "forwarded") {
      successCount = c;
      totalPiForwarded += t;
    } else if (row.status === "failed") {
      failedCount = c;
    } else if (row.status === "pending") {
      pendingCount = c;
    }
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
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [transfer] = await db.select().from(transfersTable).where(eq(transfersTable.id, params.data.id));
  if (!transfer) {
    res.status(404).json({ error: "Transfer not found" });
    return;
  }

  res.json(GetTransferResponse.parse(serializeTransfer(transfer)));
});

export default router;
