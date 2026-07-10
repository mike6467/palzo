import { Keypair, Horizon, TransactionBuilder, Operation, Asset } from "stellar-sdk";
import { db, walletsTable, transfersTable, lockedBalancesTable } from "@workspace/db";
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
  // Skip actual polling until this timestamp — set after a 429 so we back off
  // instead of continuing to hammer the API on every tick.
  backoffUntilMs: number;
  consecutiveRateLimits: number;
}

// After a 429, back off exponentially (capped) before hitting this wallet's
// endpoint again, instead of retrying on the very next fixed-interval tick.
const RATE_LIMIT_BASE_BACKOFF_MS = 2_000;
const RATE_LIMIT_MAX_BACKOFF_MS = 60_000;

const states = new Map<number, WalletMonitorState>();

// Serializes all outbound forwarding transactions for a given wallet
// (pollWallet's incoming-payment forward and the post-claim sweep both submit
// payments from the same source account/sequence). Without this, the two
// paths can race and submit competing transactions against the same wallet.
const walletForwardLocks = new Map<number, Promise<unknown>>();
async function withWalletForwardLock<T>(walletId: number, fn: () => Promise<T>): Promise<T> {
  const prior = walletForwardLocks.get(walletId) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => (release = resolve));
  walletForwardLocks.set(
    walletId,
    prior.then(() => next)
  );
  await prior;
  try {
    return await fn();
  } finally {
    release!();
  }
}

function getOrCreateState(walletId: number): WalletMonitorState {
  if (!states.has(walletId)) {
    states.set(walletId, {
      running: false,
      lastCheckedAt: null,
      lastError: null,
      intervalHandle: null,
      seenTxHashes: new Set(),
      backoffUntilMs: 0,
      consecutiveRateLimits: 0,
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

// ---------------------------------------------------------------------------
// Locked (claimable) balance monitoring
//
// Pi lockups are represented on Horizon as "claimable balances": the source
// wallet is the sole claimant, gated by a `not_before` time predicate. Once
// that time passes the balance becomes claimable. We track each one and
// ramp polling frequency up dramatically as the unlock time approaches so we
// never miss the instant it opens — then immediately claim + forward using a
// fee-bump transaction paid for by a sponsor wallet (so the claim/forward
// never has to wait on, or eat into, the unlocking balance itself).
// ---------------------------------------------------------------------------

// Poll cadence tiers, keyed by "how far from unlock" in milliseconds.
const FAR_POLL_MS = 15_000; // > 30s away: check every 15s
const NEAR_POLL_MS = 500; // <= 30s away: check every 500ms
const IMMINENT_POLL_MS = 100; // <= 3s away: check every 100ms
const IMMINENT_WINDOW_MS = 3_000;
const NEAR_WINDOW_MS = 30_000;

interface LockedBalanceClaimant {
  destination: string;
  predicate: ClaimPredicate;
}

interface ClaimPredicate {
  unconditional?: boolean;
  and?: ClaimPredicate[];
  or?: ClaimPredicate[];
  not?: ClaimPredicate;
  abs_before?: string;
  rel_before?: string;
}

interface HorizonClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  claimants: LockedBalanceClaimant[];
  last_modified_time: string;
}

interface LockedBalanceState {
  timeoutHandle: NodeJS.Timeout | null;
  claiming: boolean;
}

const lockedBalanceStates = new Map<string, LockedBalanceState>();

function getOrCreateLockedState(balanceId: string): LockedBalanceState {
  if (!lockedBalanceStates.has(balanceId)) {
    lockedBalanceStates.set(balanceId, { timeoutHandle: null, claiming: false });
  }
  return lockedBalanceStates.get(balanceId)!;
}

export function getTrackedLockedBalanceIds(): string[] {
  return Array.from(lockedBalanceStates.keys());
}

// Extract the earliest "unlock" (not-before) timestamp from a claim predicate tree
// for our own claimant entry. Returns null for unconditional (already claimable) or
// predicates we can't interpret as a simple time-lock.
// Horizon represents claim predicate times as RFC3339 strings (e.g.
// "2026-07-10T12:00:00Z"), but some Stellar tooling / raw XDR conversions emit
// plain Unix epoch-seconds strings (e.g. "1783771200") instead. Handle both so
// a format mismatch can never silently produce an invalid/NaN unlock time.
function parsePredicateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    // Epoch seconds
    return new Date(Number(trimmed) * 1000);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function extractUnlockTime(predicate: ClaimPredicate): Date | null {
  if (predicate.unconditional) return null;
  // A bare `abs_before` (not wrapped in `not`) means "claimable *before* this
  // deadline" — i.e. already claimable now, with an expiry, not a future unlock.
  // Only `not: { abs_before }` means "NOT claimable before this time", which is
  // the actual lockup/unlock predicate we care about.
  if (predicate.not?.abs_before) {
    return parsePredicateTime(predicate.not.abs_before);
  }
  if (predicate.abs_before) {
    return null;
  }
  if (predicate.and) {
    const times = predicate.and.map(extractUnlockTime).filter((d): d is Date => !!d);
    if (times.length > 0) return new Date(Math.max(...times.map((d) => d.getTime())));
  }
  if (predicate.or) {
    const times = predicate.or.map(extractUnlockTime).filter((d): d is Date => !!d);
    if (times.length > 0) return new Date(Math.min(...times.map((d) => d.getTime())));
  }
  return null;
}

export async function fetchClaimableBalances(claimantAddress: string): Promise<HorizonClaimableBalance[]> {
  const url = `${PI_HORIZON_URL}/claimable_balances?claimant=${claimantAddress}&limit=50`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    throw new Error(`Failed to fetch claimable balances: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as { _embedded?: { records?: HorizonClaimableBalance[] } };
  return data?._embedded?.records ?? [];
}

// Builds and submits a claim_claimable_balance + payment transaction.
//
// NOTE on sponsor fees: Pi Network's Horizon fork rejects CAP-15 fee-bump
// transactions outright — every submission comes back
// `Bad request - Invalid Envelope Type Stellar::EnvelopeType.envelope_type_tx_fee_bump(5)`.
// Confirmed live against https://api.mainnet.minepi.com on 2026-07-10.
// So instead of a fee-bump, when a sponsor key is configured we make the
// SPONSOR account the transaction envelope's source — which is what pays the
// fee and owns the sequence number — while each operation's own `source` is
// set explicitly to the wallet address. Both the wallet and the sponsor sign
// the same (ordinary, non-fee-bump) transaction: the wallet authorizes the
// claim/payment operations, the sponsor authorizes being the fee/sequence
// payer. This is standard Stellar operation-source-override, not CAP-15, so
// Pi's Horizon fork accepts it.
async function claimAndForwardLockedBalance(
  balanceId: string,
  amount: string,
  sourceAddress: string,
  destinationAddress: string,
  secretKey: string,
  sponsorSecretKey: string | null
): Promise<string> {
  const server = new Horizon.Server(PI_HORIZON_URL, { allowHttp: false });
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const sponsorKeypair = sponsorSecretKey ? Keypair.fromSecret(sponsorSecretKey) : null;

  const fee = await server.fetchBaseFee();

  // The account that owns the tx envelope pays the fee and supplies the
  // sequence number. Use the sponsor for that when configured; otherwise the
  // wallet pays its own fee (and we hold back a small buffer from the amount
  // forwarded so the wallet's fee payment doesn't dip into its reserve).
  const txSourceAddress = sponsorKeypair ? sponsorKeypair.publicKey() : sourceAddress;
  const txSourceAccount = await server.loadAccount(txSourceAddress);
  const opSource = sponsorKeypair ? sourceAddress : undefined;

  const forwardable = sponsorKeypair
    ? parseFloat(amount)
    : Math.max(parseFloat(amount) - FEE_BUFFER_PI, 0);

  const builder = new TransactionBuilder(txSourceAccount, {
    fee: fee.toString(),
    networkPassphrase: PI_NETWORK_PASSPHRASE,
  }).addOperation(Operation.claimClaimableBalance({ balanceId, source: opSource }));

  if (forwardable > 0) {
    builder.addOperation(
      Operation.payment({
        destination: destinationAddress,
        asset: Asset.native(),
        amount: forwardable.toFixed(7),
        source: opSource,
      })
    );
  }

  const tx = builder.setTimeout(30).build();
  tx.sign(sourceKeypair);
  if (sponsorKeypair) tx.sign(sponsorKeypair);

  const result = await server.submitTransaction(tx);
  // Horizon can resolve without throwing even when the transaction wasn't
  // actually applied — never treat this as a claim unless both are present.
  if (!result.successful || !result.hash) {
    throw new Error(
      `Transaction was not successful (successful=${String(result.successful)}, hash=${String(result.hash)})`
    );
  }
  return result.hash;
}

// After a locked balance is claimed, the wallet's on-chain balance can end up
// with spendable Pi beyond the reserve that wasn't part of the claim itself
// (e.g. rounding leftovers, or funds that arrived before monitoring started
// and were never picked up by the incoming-payment watcher in pollWallet,
// which only reacts to newly-seen payments — not a wallet's resting balance).
// Sweep it to the destination the same way a regular incoming-payment forward
// would, so nothing is left stranded above the reserve after a claim.
async function sweepAvailableBalance(walletId: number, wallet: typeof walletsTable.$inferSelect, reason: string) {
  if (!wallet.sourceAddress || !wallet.destinationAddress || !wallet.secretKey) return;

  // Never let a sweep failure propagate to the caller: this runs right after a
  // claim has already succeeded, and the claim's "claimed" status must stay
  // final regardless of what happens here.
  try {
    await withWalletForwardLock(walletId, async () => {
      // Re-fetch balance INSIDE the lock: any concurrent forward that just
      // finished waiting on this same lock could have already changed it, so
      // a balance fetched before acquiring the lock could be stale here.
      const currentBalance = await fetchWalletBalance(wallet.sourceAddress!);
      const forwardableAmount = parseFloat((currentBalance - TOTAL_HOLD_PI).toFixed(7));
      if (forwardableAmount <= 0) {
        logger.info(
          { walletId, currentBalance, totalHold: TOTAL_HOLD_PI },
          "Post-claim balance sweep: nothing above reserve to forward"
        );
        return;
      }

      logger.info(
        { walletId, currentBalance, forwardableAmount, reason },
        "Post-claim balance sweep: forwarding leftover spendable balance"
      );

      const [record] = await db
        .insert(transfersTable)
        .values({
          walletId,
          incomingTxHash: `sweep-${reason}-${crypto.randomUUID()}`,
          amount: forwardableAmount.toFixed(7),
          fromAddress: wallet.sourceAddress,
          status: "pending",
        })
        .returning();

      try {
        const outTxHash = await forwardPi(
          wallet.sourceAddress!,
          wallet.destinationAddress!,
          wallet.secretKey!,
          forwardableAmount.toFixed(7)
        );
        await db
          .update(transfersTable)
          .set({ status: "forwarded", outgoingTxHash: outTxHash, forwardedAt: new Date() })
          .where(eq(transfersTable.id, record.id));
        logger.info({ walletId, outTxHash, forwardedAmount: forwardableAmount }, "Post-claim sweep forwarded successfully");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(transfersTable).set({ status: "failed", errorMessage: msg }).where(eq(transfersTable.id, record.id));
        logger.error({ err, walletId }, "Post-claim balance sweep forward failed");
      }
    });
  } catch (err) {
    logger.error({ err, walletId }, "Post-claim balance sweep encountered an unexpected error");
  }
}

async function attemptClaim(walletId: number, wallet: typeof walletsTable.$inferSelect, balance: HorizonClaimableBalance) {
  const state = getOrCreateLockedState(balance.id);
  if (state.claiming) return;
  state.claiming = true;

  await db
    .update(lockedBalancesTable)
    .set({ status: "claiming" })
    .where(eq(lockedBalancesTable.balanceId, balance.id));

  try {
    const txHash = await claimAndForwardLockedBalance(
      balance.id,
      balance.amount,
      wallet.sourceAddress!,
      wallet.destinationAddress!,
      wallet.secretKey!,
      wallet.sponsorSecretKey ?? null
    );
    await db
      .update(lockedBalancesTable)
      .set({ status: "claimed", claimTxHash: txHash, claimedAt: new Date() })
      .where(eq(lockedBalancesTable.balanceId, balance.id));
    logger.info({ walletId, balanceId: balance.id, txHash }, "Claimed and forwarded locked Pi");
    stopTrackingLockedBalance(balance.id);
    await sweepAvailableBalance(walletId, wallet, `claim-${balance.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, walletId, balanceId: balance.id }, "Claim attempt failed — will retry");
    await db
      .update(lockedBalancesTable)
      .set({ status: "monitoring", errorMessage: msg })
      .where(eq(lockedBalancesTable.balanceId, balance.id));
    state.claiming = false;
    // Retry almost immediately — the balance is unlocked and still claimable.
    scheduleLockedBalanceCheck(walletId, balance.id, 250);
  }
}

function stopTrackingLockedBalance(balanceId: string) {
  const state = lockedBalanceStates.get(balanceId);
  if (state?.timeoutHandle) clearTimeout(state.timeoutHandle);
  lockedBalanceStates.delete(balanceId);
}

// Computes the correct poll delay given how far away unlock is. This is the
// core of the "never miss it" guarantee: as we approach the unlock time the
// delay shrinks from 15s all the way down to 100ms.
export function computeLockedBalancePollDelayMs(msUntilUnlock: number): number {
  if (msUntilUnlock <= 0) return 0;
  if (msUntilUnlock <= IMMINENT_WINDOW_MS) return IMMINENT_POLL_MS;
  if (msUntilUnlock <= NEAR_WINDOW_MS) return NEAR_POLL_MS;
  return FAR_POLL_MS;
}

function scheduleLockedBalanceCheck(walletId: number, balanceId: string, delayMs: number) {
  const state = getOrCreateLockedState(balanceId);
  if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
  state.timeoutHandle = setTimeout(() => {
    checkLockedBalance(walletId, balanceId).catch((err) => {
      logger.error({ err, walletId, balanceId }, "Locked balance check failed");
    });
  }, delayMs);
}

async function checkLockedBalance(walletId: number, balanceId: string) {
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  const [record] = await db
    .select()
    .from(lockedBalancesTable)
    .where(eq(lockedBalancesTable.balanceId, balanceId));

  if (!wallet || !record || record.status !== "monitoring") return;

  let balances: HorizonClaimableBalance[];
  try {
    balances = await fetchClaimableBalances(wallet.sourceAddress!);
  } catch (err) {
    logger.warn({ err, walletId, balanceId }, "Failed to refresh claimable balances — retrying shortly");
    scheduleLockedBalanceCheck(walletId, balanceId, 1000);
    return;
  }

  const balance = balances.find((b) => b.id === balanceId);
  if (!balance) {
    // No longer present: either already claimed elsewhere or expired/removed.
    await db
      .update(lockedBalancesTable)
      .set({ status: "expired" })
      .where(eq(lockedBalancesTable.balanceId, balanceId));
    stopTrackingLockedBalance(balanceId);
    return;
  }

  const unlockAt = record.unlockAt ? new Date(record.unlockAt) : null;
  const msUntilUnlock = unlockAt ? unlockAt.getTime() - Date.now() : 0;

  if (msUntilUnlock <= 0) {
    await attemptClaim(walletId, wallet, balance);
    return;
  }

  const delay = computeLockedBalancePollDelayMs(msUntilUnlock);
  logger.info(
    { walletId, balanceId, msUntilUnlock, nextPollMs: delay },
    "Locked Pi still pending unlock — scheduling next check"
  );
  scheduleLockedBalanceCheck(walletId, balanceId, delay);
}

// Scans Horizon for claimable balances belonging to this wallet's source address,
// records any new ones, and (re)starts the high-frequency countdown watcher for each.
export async function scanForLockedBalances(walletId: number): Promise<void> {
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  if (!wallet?.sourceAddress || !wallet?.destinationAddress || !wallet?.secretKey) return;

  let balances: HorizonClaimableBalance[];
  try {
    balances = await fetchClaimableBalances(wallet.sourceAddress);
  } catch (err) {
    logger.warn({ err, walletId }, "Could not fetch claimable balances");
    return;
  }

  for (const balance of balances) {
    if (lockedBalanceStates.has(balance.id)) continue; // already tracked

    const [existing] = await db
      .select()
      .from(lockedBalancesTable)
      .where(eq(lockedBalancesTable.balanceId, balance.id));

    const mine = balance.claimants.find((c) => c.destination === wallet.sourceAddress);
    const unlockAt = mine ? extractUnlockTime(mine.predicate) : null;

    if (!existing) {
      try {
        await db
          .insert(lockedBalancesTable)
          .values({
            walletId,
            balanceId: balance.id,
            amount: balance.amount,
            unlockAt,
            status: "monitoring",
          })
          .onConflictDoNothing({ target: lockedBalancesTable.balanceId });
        logger.info(
          { walletId, balanceId: balance.id, amount: balance.amount, unlockAt },
          "Detected new locked Pi balance — tracking for unlock"
        );
      } catch (err) {
        // Don't let one bad insert (e.g. a race with another scan) abort the whole
        // scan loop and skip checking the remaining balances.
        logger.error({ err, walletId, balanceId: balance.id }, "Failed to persist locked balance — skipping this one");
        continue;
      }
    } else if (existing.status !== "monitoring") {
      continue; // already claimed/failed permanently — don't re-track
    }

    const msUntilUnlock = unlockAt ? unlockAt.getTime() - Date.now() : 0;
    scheduleLockedBalanceCheck(walletId, balance.id, msUntilUnlock <= 0 ? 0 : computeLockedBalancePollDelayMs(msUntilUnlock));
  }
}

export async function getLockedBalancesForWallet(walletId: number) {
  return db
    .select()
    .from(lockedBalancesTable)
    .where(eq(lockedBalancesTable.walletId, walletId))
    .orderBy(lockedBalancesTable.createdAt);
}

function stopTrackingWalletLockedBalances(walletId: number, records: { balanceId: string }[]) {
  for (const r of records) stopTrackingLockedBalance(r.balanceId);
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

  // If we recently got rate-limited on this wallet, skip the actual HTTP call
  // until the backoff window elapses — cheap no-op instead of hammering the API.
  if (Date.now() < state.backoffUntilMs) {
    return;
  }

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
      if (resp.status === 429) {
        state.consecutiveRateLimits += 1;
        const backoffMs = Math.min(
          RATE_LIMIT_BASE_BACKOFF_MS * 2 ** (state.consecutiveRateLimits - 1),
          RATE_LIMIT_MAX_BACKOFF_MS
        );
        state.backoffUntilMs = Date.now() + backoffMs;
        logger.warn({ walletId, backoffMs, consecutiveRateLimits: state.consecutiveRateLimits }, "Pi API rate-limited — backing off");
      } else {
        logger.warn({ walletId, status: resp.status, statusText: resp.statusText }, "Pi API returned error");
      }
      return;
    }

    // Successful response — clear any prior rate-limit backoff.
    state.consecutiveRateLimits = 0;
    state.backoffUntilMs = 0;

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
        const outTxHash = await withWalletForwardLock(walletId, () =>
          forwardPi(wallet.sourceAddress!, wallet.destinationAddress!, wallet.secretKey!, forwardableAmount.toFixed(7))
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

  // Also scan for newly-appeared locked (claimable) balances on every regular poll.
  // Balances already being tracked get their own independent high-frequency timers
  // and are not re-scheduled here.
  try {
    await scanForLockedBalances(walletId);
  } catch (err) {
    logger.error({ err, walletId }, "Locked balance scan error");
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

  const intervalMs = (wallet.pollIntervalSeconds ?? 1) * 1000;

  await pollWallet(walletId);
  await scanForLockedBalances(walletId);
  state.intervalHandle = setInterval(() => {
    pollWallet(walletId).catch((err) => {
      logger.error({ err, walletId }, "Unhandled monitor error");
    });
  }, intervalMs);

  logger.info({ walletId, intervalMs }, "Wallet monitor started");
}

// Called once at server startup. Any locked_balances row still marked "claiming"
// is necessarily orphaned — "claiming" only ever means an in-flight attempt in
// THIS process's memory, and a fresh process has no in-flight attempts. Without
// this reset, a claim interrupted by a restart/deploy would stay stuck in
// "claiming" forever (scanForLockedBalances skips any existing row whose status
// isn't "monitoring", so nothing would ever retry it).
export async function resetOrphanedClaimingBalances(): Promise<number> {
  const rows = await db
    .update(lockedBalancesTable)
    .set({ status: "monitoring" })
    .where(eq(lockedBalancesTable.status, "claiming"))
    .returning({ id: lockedBalancesTable.id, balanceId: lockedBalancesTable.balanceId });
  if (rows.length > 0) {
    logger.warn(
      { count: rows.length, balanceIds: rows.map((r) => r.balanceId) },
      "Reset orphaned 'claiming' locked balances back to 'monitoring' after restart"
    );
  }
  return rows.length;
}

// Called once at server startup to resume monitoring for every fully-configured
// wallet. Without this, monitoring silently stops on every restart/deploy until
// a human notices and clicks Start again in the UI — a real risk for time-sensitive
// locked-balance claims.
export async function resumeAllWalletMonitors(): Promise<void> {
  const wallets = await db.select().from(walletsTable).where(eq(walletsTable.isConfigured, true));
  for (const wallet of wallets) {
    try {
      await startWalletMonitor(wallet.id);
    } catch (err) {
      logger.error({ err, walletId: wallet.id }, "Failed to resume wallet monitor on startup");
    }
  }
  if (wallets.length > 0) {
    logger.info({ count: wallets.length }, "Resumed wallet monitors after startup");
  }
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

  // Stopping the wallet monitor also stops any in-flight unlock watchers for this
  // wallet's locked balances — otherwise a claim+forward could still fire after the
  // user believes monitoring is off.
  stopAllLockedBalanceTrackingForWallet(walletId).catch((err) => {
    logger.error({ err, walletId }, "Failed to stop locked balance trackers on monitor stop");
  });
}

// Stops the high-frequency unlock watchers for every locked balance belonging to this
// wallet — used when a wallet monitor is stopped or deleted so no orphaned timers keep firing.
export async function stopAllLockedBalanceTrackingForWallet(walletId: number): Promise<void> {
  const records = await getLockedBalancesForWallet(walletId);
  stopTrackingWalletLockedBalances(walletId, records);
}
