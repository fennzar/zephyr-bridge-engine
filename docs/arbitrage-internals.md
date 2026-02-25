# Arbitrage Internals

This document covers the routing definitions, edge math, clip sizing, calibration, and planner pipeline that power the `ArbitrageStrategy`.

## ARB_DEFS: Routing Definitions

Eight predefined arbitrage legs in `src/domain/arbitrage/routing.ts`. Each leg has an "open" side (EVM swap) and one or more "close" sides (native conversion or CEX trade).

| # | Asset | Direction | Open (EVM) | Close Native | Close CEX |
|---|-------|-----------|------------|--------------|-----------|
| 1 | ZEPH | `evm_discount` | WZSD.e -> WZEPH.e (swapEVM) | ZEPH.n -> ZSD.n (nativeMint) | ZEPH.x -> USDT.x (tradeCEX) |
| 2 | ZEPH | `evm_premium` | WZEPH.e -> WZSD.e (swapEVM) | ZSD.n -> ZEPH.n (nativeRedeem) | USDT.x -> ZEPH.x (tradeCEX) |
| 3 | ZSD | `evm_discount` | USDT.e -> WZSD.e (swapEVM) | WZSD.e -> ZSD.n (unwrap) | -- |
| 4 | ZSD | `evm_premium` | WZSD.e -> USDT.e (swapEVM) | ZEPH.n -> ZSD.n (nativeMint) | -- |
| 5 | ZRS | `evm_discount` | WZEPH.e -> WZRS.e (swapEVM) | ZRS.n -> ZEPH.n (nativeRedeem) | -- |
| 6 | ZRS | `evm_premium` | WZRS.e -> WZEPH.e (swapEVM) | ZEPH.n -> ZRS.n (nativeRedeem) | -- |
| 7 | ZYS | `evm_discount` | WZSD.e -> WZYS.e (swapEVM) | ZYS.n -> ZSD.n (nativeRedeem) | -- |
| 8 | ZYS | `evm_premium` | WZYS.e -> WZSD.e (swapEVM) | ZSD.n -> ZYS.n (nativeMint) | -- |

Only ZEPH legs have a CEX close option (via MEXC). ZSD, ZRS, and ZYS close exclusively through native Zephyr conversions.

### Step semantics

Each step in a leg definition is semantic (e.g., "nativeMint"). The planner materializes these into concrete `ExecutionStep[]` with wrap/unwrap operations inserted where needed to move assets between venues.

## Edge Math

Edge formulas in `src/domain/arbitrage/edge.ts` compute the net profit in basis points after fees and gas.

### Helper functions

```typescript
toBps(x: number) = Math.round(x * 10_000)
gasBps(gasUsd: number, notionalUsd: number) = (gasUsd / notionalUsd) * 10_000
```

### edgeStableRail

For USDT/WZSD comparison (ZSD peg arbitrage):

```
gapBps = toBps(1 - usdtPerWzsd)
costs  = toBps(FEES.STABLE) + gasBps(gasUsd, clipUsd)
edge   = gapBps - costs
```

Positive edge when WZSD price deviates from $1.00 by more than the swap fee + gas.

### edgeZephCex

For ZEPH via CEX (EVM vs MEXC):

```
gross = toBps((evmZephUsd - cexZephUsd) / cexZephUsd)
costs = toBps(FEES.WZEPH + FEES.STABLE + FEES.CEX) + gasBps(gasUsd, clipUsd)
edge  = gross - costs
```

Combined fees: 0.30% (WZEPH swap) + 0.03% (stable swap) + 0.10% (CEX taker) = 0.43%.

### edgeZysBridge

For ZYS via native bridge:

```
gross = toBps((evmZysPerZsd - nativeZysPerZsd) / nativeZysPerZsd)
costs = toBps(FEES.WZYS + FEES.WRAP) + gasBps(gasUsd, clipUsd)
edge  = gross - costs
```

Combined fees: 0.05% (WZYS swap) + 0.05% (wrap/unwrap) = 0.10%.

## Fee Constants

From `src/domain/arbitrage/constants.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `FEES.STABLE` | 0.0003 (0.03%) | USDT/WZSD pool swap fee |
| `FEES.WZEPH` | 0.003 (0.30%) | WZEPH/WZSD pool swap fee |
| `FEES.WZYS` | 0.0005 (0.05%) | WZYS/WZSD pool swap fee |
| `FEES.CEX` | 0.001 (0.10%) | MEXC taker fee |
| `FEES.WRAP` | 0.0005 (0.05%) | Round-trip wrap/unwrap overhead |

## Threshold Constants

Minimum edge in basis points to trigger an opportunity:

| Asset | Threshold (bps) |
|-------|-----------------|
| STABLE (ZSD) | 12 |
| ZEPH | 100 |
| ZYS | 30 |
| ZRS | 100 |

## Pool Depth Cap

```typescript
MAX_POOL_SHARE = 0.1  // 10% of pool depth per clip
```

No single trade should consume more than 10% of the quoted pool depth to limit price impact.

## Clip Sizing

### pickClip

```typescript
function pickClip(
  maxPoolUsd: number,       // Pool depth in USD
  maxInvUsd: number | null, // Available inventory in USD
  minTicketUsd = 500,       // Minimum clip size
  maxShare = 0.1            // MAX_POOL_SHARE
): number
```

Returns the smaller of `maxPoolUsd * maxShare` and `maxInvUsd`. Returns 0 if the result is below `minTicketUsd` ($500).

### Full clip estimation

`estimateClipAmount()` performs pool-aware sizing:

1. Find the EVM pool for the leg's open step
2. Estimate pool capacity: `(pool.tvlUsd / 2) * MAX_POOL_SHARE`
3. Convert USD cap to token amount using the asset's USD price
4. Return 0 if the clip would be below $500

The result is a `ClipEstimate` with the amount in both decimal and bigint (atomic) form.

## Calibration

Calibration refines the clip amount to find the largest profitable trade. Two algorithms are used depending on the close venue.

### Native route calibration

Binary search with expansion/contraction in `calibration.clip.ts`.

**Parameters:**
- Tolerance: 5 bps margin
- Min amount: `max(initialAmount * 1e-6, 1e-12)`
- Max iterations: 64 (expansion) + 64 (binary search)

**Algorithm:**
1. Sample at the initial amount
2. If within tolerance, return immediately
3. **Expansion phase:** If pool price is below reference, double the amount each iteration. If above, halve it. Continue until a bracket is found (one sample above, one below the target)
4. **Binary search phase:** Bisect the bracket until convergence
5. **Selection:** Prefer "safe" samples where pool price <= reference price (the trade doesn't overshoot). Among safe samples, pick the largest amount

### CEX route calibration

Secant method with expansion in `calibration.twoVenue.ts`.

**Parameters:**
- Tolerance: 10 bps
- Max iterations: 32
- Expansion factor: 1.25x up, 0.8x down
- Max expansions: 32 per direction

**Algorithm:**
1. Sample at the initial amount
2. **Expansion phase:** Scale up by 1.25x or down by 0.8x until the price gap brackets zero
3. **Secant method:** Use the two bracketing samples to estimate the zero crossing:
   ```
   nextAmount = (low.amount * high.gap - high.amount * low.gap) / (high.gap - low.gap)
   ```
4. Fall back to midpoint bisection if secant produces an out-of-bounds estimate

## Market Analysis

`analyzeArbMarkets()` in `src/domain/arbitrage/analysis.ts` produces a per-asset overview:

For each asset (ZSD, ZEPH, ZYS, ZRS):

1. Extract the EVM pool price and native/CEX reference price from `GlobalState`
2. Compute the gap: `gapBps = round(((dexPrice - refPrice) / refPrice) * 10_000)`
3. Determine direction:
   - `gapBps >= threshold` -> `evm_premium`
   - `gapBps <= -threshold` -> `evm_discount`
   - Otherwise -> `aligned`

**Reference prices per asset:**

| Asset | Reference Source |
|-------|-----------------|
| ZSD | USDT peg ($1.00) |
| ZEPH | CEX ZEPH/USDT mid (fallback: native spot) |
| ZYS | Native ZYS/ZSD spot rate |
| ZRS | Native ZRS/ZEPH spot rate |

## Planner Pipeline

`buildArbPlan()` in `src/domain/arbitrage/planner.ts` produces an `ArbPlan` through five stages:

### Stage 1: Inventory

Detect shortfalls in required assets. Flag if insufficient balance to execute. Build inventory preparation steps.

### Stage 2: Preparation

Build multi-path routing for the open leg and close leg variants (native, CEX). Evaluate allowance checks and path costs.

### Stage 3: Execution

Concrete execution steps for the open leg and the selected close variant, using the calibrated clip amount. Blocked if any prerequisite preparation step is blocked.

### Stage 4: Settlement

Convert intermediate assets to WZSD.e. This normalizes the position back to a stable asset after the arb completes.

### Stage 5: Realisation

Convert from WZSD.e to USDT.e for profit realisation in stables. Only runs if the settlement asset is not already USDT.e.

### Cost estimation

Each stage accumulates costs from path evaluations. The final plan is marked as blocked if any critical step cannot be satisfied. The `ArbPlan` summary includes total estimated cost, expected PnL, and duration.

## Fee Estimation Per $1,000

Approximate costs for a $1,000 clip:

| Component | Cost |
|-----------|------|
| EVM swap (ZSD) | ~$0.30 (3 bps) |
| EVM swap (ZEPH) | ~$3.00 (30 bps) |
| Bridge unwrap | ~$10.00 (1%) |
| Native conversion (ZRS) | ~$10.00 (100 bps) |
| Native conversion (ZSD/ZYS) | ~$1.00 (10 bps) |
| CEX fee | ~$1.00 (10 bps) |
| Gas | ~$5.00 |

## Step Duration Estimates

| Operation | Duration |
|-----------|----------|
| `wrap` / `unwrap` | 20 minutes |
| CEX deposit | 40 minutes |
| CEX withdrawal | 10 minutes |
| `swapEVM` | 30 seconds |
| `tradeCEX` | 5 seconds |
| `nativeMint` / `nativeRedeem` | 2 minutes |
