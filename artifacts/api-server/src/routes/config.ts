import { Router, type IRouter } from "express";
import { db, walletConfigTable } from "@workspace/db";
import { UpdateConfigBody, GetConfigResponse, UpdateConfigResponse } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function ensureConfig() {
  const existing = await db.select().from(walletConfigTable).where(eq(walletConfigTable.id, 1));
  if (existing.length === 0) {
    await db.insert(walletConfigTable).values({ id: 1 }).onConflictDoNothing();
  }
  const [cfg] = await db.select().from(walletConfigTable).where(eq(walletConfigTable.id, 1));
  return cfg;
}

router.get("/config", async (req, res): Promise<void> => {
  const cfg = await ensureConfig();
  res.json(
    GetConfigResponse.parse({
      sourceAddress: cfg.sourceAddress ?? null,
      destinationAddress: cfg.destinationAddress ?? null,
      isConfigured: !!(cfg.sourceAddress && cfg.destinationAddress && cfg.secretKey),
      pollIntervalSeconds: cfg.pollIntervalSeconds ?? 30,
      hasSecretKey: !!cfg.secretKey,
    })
  );
});

router.put("/config", async (req, res): Promise<void> => {
  const parsed = UpdateConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof walletConfigTable.$inferInsert> = {};
  if (parsed.data.sourceAddress !== undefined) updates.sourceAddress = parsed.data.sourceAddress;
  if (parsed.data.destinationAddress !== undefined) updates.destinationAddress = parsed.data.destinationAddress;
  if (parsed.data.secretKey !== undefined && parsed.data.secretKey !== null) {
    updates.secretKey = parsed.data.secretKey;
  }
  if (parsed.data.pollIntervalSeconds !== undefined) updates.pollIntervalSeconds = parsed.data.pollIntervalSeconds;

  await ensureConfig();
  const [cfg] = await db
    .update(walletConfigTable)
    .set(updates)
    .where(eq(walletConfigTable.id, 1))
    .returning();

  const isConfigured = !!(cfg.sourceAddress && cfg.destinationAddress && cfg.secretKey);
  await db.update(walletConfigTable).set({ isConfigured }).where(eq(walletConfigTable.id, 1));

  res.json(
    UpdateConfigResponse.parse({
      sourceAddress: cfg.sourceAddress ?? null,
      destinationAddress: cfg.destinationAddress ?? null,
      isConfigured,
      pollIntervalSeconds: cfg.pollIntervalSeconds ?? 30,
      hasSecretKey: !!cfg.secretKey,
    })
  );
});

export default router;
