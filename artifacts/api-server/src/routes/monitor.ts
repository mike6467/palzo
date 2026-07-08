import { Router, type IRouter } from "express";
import { startMonitor, stopMonitor, getMonitorState } from "../lib/monitor";
import { db, transfersTable } from "@workspace/db";
import { GetMonitorStatusResponse, StartMonitorResponse, StopMonitorResponse } from "@workspace/api-zod";
import { count, sum, eq } from "drizzle-orm";

const router: IRouter = Router();

async function buildStatus() {
  const state = getMonitorState();

  const [statsRows] = await Promise.all([
    db
      .select({
        status: transfersTable.status,
        cnt: count(),
        total: sum(transfersTable.amount),
      })
      .from(transfersTable)
      .groupBy(transfersTable.status),
  ]);

  let totalForwarded = 0;
  let totalTransactions = 0;

  for (const row of statsRows) {
    const c = Number(row.cnt);
    totalTransactions += c;
    if (row.status === "forwarded") {
      totalForwarded += Number(row.total ?? 0);
    }
  }

  return {
    running: state.running,
    lastCheckedAt: state.lastCheckedAt ? state.lastCheckedAt.toISOString() : null,
    lastError: state.lastError ?? null,
    totalForwarded: totalForwarded.toFixed(7),
    totalTransactions,
  };
}

router.get("/monitor/status", async (_req, res): Promise<void> => {
  const status = await buildStatus();
  res.json(GetMonitorStatusResponse.parse(status));
});

router.post("/monitor/start", async (req, res): Promise<void> => {
  try {
    await startMonitor();
    const status = await buildStatus();
    res.json(StartMonitorResponse.parse(status));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

router.post("/monitor/stop", async (_req, res): Promise<void> => {
  stopMonitor();
  const status = await buildStatus();
  res.json(StopMonitorResponse.parse(status));
});

export default router;
