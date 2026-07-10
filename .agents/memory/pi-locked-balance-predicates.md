---
name: Pi Horizon claim predicates
description: How to correctly parse Stellar/Pi Horizon claimable-balance claim predicates to find a lockup's unlock time.
---

A claimable balance's claim predicate tree determines when it becomes claimable:

- A bare `abs_before` (not wrapped in `not`) means "claimable *before* this deadline" — the balance is already claimable now and merely expires at that time. Treating it as a future unlock time is wrong and can make the app wait for a balance that's already claimable.
- Only `not: { abs_before: T }` means "NOT claimable before T" — this is the actual lock/unlock predicate. `and`/`or` combine multiple predicates (take max/min of the resolved times respectively).
- The time value's format is not guaranteed to be one thing: handle both RFC3339 strings and plain Unix epoch-seconds strings defensively, and fall back to `null` (treated as "try claiming now, retry on failure") rather than producing an invalid/NaN date if the value can't be parsed.

**Why:** A code-review pass caught the bare-`abs_before` case being misread as an unlock time, and the raw string being passed straight to `new Date()` without epoch-seconds handling — both could cause the app to wait for a lockup that was already unlocked, or never schedule a check at all.

**How to apply:** Any code touching `extractUnlockTime`-style logic in `artifacts/api-server/src/lib/monitor.ts` — keep the `not.abs_before` check before the bare `abs_before` check, and keep the epoch-seconds/RFC3339 dual parsing.
