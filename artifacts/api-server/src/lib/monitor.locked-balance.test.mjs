import { extractUnlockTime, computeLockedBalancePollDelayMs } from "./monitor.ts";

function assertEqual(actual, expected, label) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const e = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== e) {
    console.error(`FAIL: ${label} — expected ${e}, got ${a}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

// unconditional predicate -> already claimable, no unlock time
assertEqual(extractUnlockTime({ unconditional: true }), null, "unconditional -> null");

// Horizon represents "not claimable before T" as { not: { abs_before: T } }
const t1 = "2026-07-10T12:00:00Z";
assertEqual(extractUnlockTime({ not: { abs_before: t1 } }), new Date(t1), "not.abs_before -> unlock time");

// a bare abs_before (no `not` wrapper) is a claim deadline, not a lock — already claimable now
assertEqual(extractUnlockTime({ abs_before: t1 }), null, "bare abs_before -> null (already claimable, has deadline)");

// and[] takes the latest (most restrictive) time
const t2 = "2026-07-10T13:00:00Z";
assertEqual(
  extractUnlockTime({ and: [{ not: { abs_before: t1 } }, { not: { abs_before: t2 } }] }),
  new Date(t2),
  "and[] -> max(unlock times)"
);

// or[] takes the earliest (least restrictive) time
assertEqual(
  extractUnlockTime({ or: [{ not: { abs_before: t1 } }, { not: { abs_before: t2 } }] }),
  new Date(t1),
  "or[] -> min(unlock times)"
);

// Epoch-seconds format (defensive handling in case Horizon/XDR tooling emits this instead of RFC3339)
const epochSeconds = "1783771200"; // 2026-07-10T00:00:00Z
assertEqual(
  extractUnlockTime({ not: { abs_before: epochSeconds } }),
  new Date(Number(epochSeconds) * 1000),
  "not.abs_before epoch-seconds -> correct unlock time"
);

// Malformed predicate time -> null (falls back to immediate-check-and-retry rather than NaN scheduling)
assertEqual(extractUnlockTime({ not: { abs_before: "not-a-date" } }), null, "malformed abs_before -> null, not NaN");

// Poll delay tiers — this is the "never miss the unlock" guarantee
assertEqual(computeLockedBalancePollDelayMs(-500), 0, "past unlock -> 0ms (claim now)");
assertEqual(computeLockedBalancePollDelayMs(0), 0, "exactly at unlock -> 0ms (claim now)");
assertEqual(computeLockedBalancePollDelayMs(1_000), 100, "1s away -> 100ms imminent polling");
assertEqual(computeLockedBalancePollDelayMs(3_000), 100, "exactly 3s away -> 100ms imminent polling");
assertEqual(computeLockedBalancePollDelayMs(3_001), 500, "just over 3s away -> 500ms near polling");
assertEqual(computeLockedBalancePollDelayMs(30_000), 500, "exactly 30s away -> 500ms near polling");
assertEqual(computeLockedBalancePollDelayMs(60_000), 15_000, "60s away -> far-tier poll (15s), never overshoots the 30s boundary");
assertEqual(computeLockedBalancePollDelayMs(600_000), 15_000, "10min away -> capped at far-poll interval (15s)");

if (process.exitCode === 1) {
  console.error("\nSome tests FAILED");
} else {
  console.log("\nAll locked-balance timing/predicate tests PASSED");
}
