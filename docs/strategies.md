# Strategies

All strategies implement the `Strategy` interface:

```typescript
interface Strategy {
  id: string;
  name: string;
  evaluate(state: GlobalState, inventory: InventorySnapshot): StrategyEvaluation;
  buildPlan(opportunity: StrategyOpportunity, state: GlobalState, inventory: InventorySnapshot): Promise<OperationPlan | null>;
  shouldAutoExecute(plan: OperationPlan, config: EngineConfig): boolean;
}
```

`evaluate()` scans for opportunities. `buildPlan()` converts an opportunity into an executable `OperationPlan` with ordered `ExecutionStep[]`. `shouldAutoExecute()` gates whether the plan runs without human review.

## Arbitrage (`arb`)

Detects price discrepancies between EVM (Uniswap V4) and reference venues (Zephyr native rates, MEXC).

### How it works

1. `analyzeArbMarkets(state)` computes a gap in basis points for each of the four assets (ZEPH, ZSD, ZRS, ZYS) by comparing the EVM pool price against a reference price
2. Each gap is checked against 8 predefined `ARB_DEFS` legs (see [Arbitrage Internals](arbitrage-internals.md))
3. Opportunities are generated when the gap exceeds the asset's threshold

### Default clip sizes (USD)

| Asset | Clip Size |
|-------|-----------|
| ZEPH | $500 |
| ZSD | $1,000 |
| ZRS | $250 |
| ZYS | $500 |

### Auto-execute rules

All of the following must pass:

1. `manualApproval` is `false`
2. `expectedPnl >= minProfitUsd` (default $1.00)
3. Spot/MA spread check passes (see below)
4. RR mode check passes for the asset

**Spot/MA spread gates:**

| Condition | Result |
|-----------|--------|
| Absolute spread >= 500 bps | Block all auto-execution |
| `evm_discount` + positive spread > 300 bps | Block (hurts redemption rate) |
| `evm_premium` + negative spread < -300 bps | Block (hurts mint rate) |
| ZSD and ZYS | Exempt from directional spread checks |

**RR mode restrictions:**

| RR Mode | ZEPH | ZSD | ZRS | ZYS |
|---------|------|-----|-----|-----|
| normal | Yes | Yes | Yes | Yes |
| defensive | Only if PnL >= $20 | Yes | Blocked | Yes |
| crisis | Blocked | Blocked | Blocked | Only `evm_discount` (buys) |

### Urgency

| Condition | Urgency |
|-----------|---------|
| expectedPnl > $100 | high |
| expectedPnl > $50 | medium |
| Otherwise | low |

For full routing, edge math, and calibration details, see [Arbitrage Internals](arbitrage-internals.md).

---

## Rebalancer (`rebalance`)

Monitors inventory distribution across venues and moves funds when allocations drift from targets.

### Target allocations (% of total per asset)

| Asset | EVM | Native | CEX |
|-------|-----|--------|-----|
| ZEPH | 30% | 50% | 20% |
| ZSD | 60% | 30% | 10% |
| ZRS | 40% | 60% | 0% |
| ZYS | 50% | 50% | 0% |
| USDT | 70% | 0% | 30% |

### Thresholds

| Parameter | Value |
|-----------|-------|
| Minimum deviation to trigger | 10 percentage points |
| Max single rebalance | 25% of total venue balance |
| Minimum USD value | $100 |

### Execution paths

| Route | Steps |
|-------|-------|
| EVM to Native | `unwrap` |
| Native to EVM | `wrap` |
| EVM to CEX | `unwrap` + `deposit` |
| Native to CEX | `deposit` |
| CEX to Native | `withdraw` |
| CEX to EVM | `withdraw` + `wrap` |

### Auto-execute rules

1. `manualApproval` is `false`
2. RR mode must be `normal` (defensive/crisis block all auto-execution)
3. Estimated cost <= $50

### Urgency

| Deviation | Urgency |
|-----------|---------|
| > 40% | high |
| > 25% | medium |
| Otherwise | low |

---

## Peg Keeper (`peg`)

Monitors the WZSD/USDT pool price and trades to restore the ZSD $1.00 peg.

### Thresholds by RR mode (bps)

| Parameter | Normal | Defensive | Crisis |
|-----------|--------|-----------|--------|
| Minimum deviation to trigger | 30 | 100 | 300 |
| Urgent deviation | 100 | 200 | 500 |
| Critical deviation | 300 | 500 | 1,000 |

### Clip sizing

| Absolute Deviation | Clip Size |
|--------------------|-----------|
| >= 200 bps | $2,000 |
| >= 100 bps | $1,000 |
| < 100 bps | $500 |

### Actions

| Direction | Condition | Action |
|-----------|-----------|--------|
| `zsd_premium` | ZSD > $1.00 | Swap WZSD.e to USDT.e (sell ZSD) |
| `zsd_discount` | ZSD < $1.00 | Swap USDT.e to WZSD.e (buy ZSD) |

### Auto-execute rules

| RR Mode | Condition |
|---------|-----------|
| normal | Allow if `expectedPnl > 0` |
| defensive | Require absolute deviation >= 100 bps |
| crisis | Only `zsd_discount` (buys) with absolute deviation >= 500 bps |

Always blocks if `expectedPnl < 0`.

### Profit estimation

```
grossProfit = (|deviationBps| / 10000) * clipSizeUsd
fees = clipSizeUsd * 0.03% + $2 (gas)
netProfit = grossProfit - fees
```

### Urgency

| Deviation vs Thresholds | Urgency |
|------------------------|---------|
| >= critical | critical |
| >= urgent | high |
| >= 2x minimum | medium |
| >= minimum | low |

---

## LP Manager (`lp`)

Monitors Uniswap V4 LP positions and manages range adjustments and fee collection.

### Range configs by RR mode

**ZSD ranges (absolute price, pegged to $1.00):**

| Mode | Lower | Upper |
|------|-------|-------|
| normal | $0.98 | $1.02 |
| defensive | $0.90 | $1.05 |
| crisis | $0.50 | $1.10 |

**ZEPH ranges (multiplier of current mid-price):**

| Mode | Lower | Upper |
|------|-------|-------|
| normal | 0.80x | 1.20x |
| defensive | 0.70x | 1.30x |
| crisis | 0.50x | 1.50x |

### Detected opportunities

| Trigger | Action | Urgency |
|---------|--------|---------|
| Position out of range (`currentTick < tickLower` or `>= tickUpper`) | `reposition` | high |
| Unclaimed fees > $50 | `collect_fees` | low |
| Range bounds drifted > 10% from recommended | `adjust_range` | medium |

### Actions

| Action | Steps | Cost Estimate |
|--------|-------|---------------|
| `collect_fees` | `lpCollect` | $5 (gas) |
| `reposition` | `lpBurn` + `lpMint` in new range | $20 |
| `adjust_range` | `lpBurn` + `lpMint` in adjusted range | $20 |
| `add_liquidity` | `lpMint` | $10 |
| `remove_liquidity` | `lpBurn` | $10 |

### Auto-execute rules

Only `collect_fees` with `feesEarned > $10` can auto-execute. All other LP operations (reposition, adjust range, add/remove liquidity) require manual approval because they are capital-intensive and strategy-dependent.

---

## Summary: Behavior by RR Mode

| Strategy | Normal (>= 400%) | Defensive (200-400%) | Crisis (< 200%) |
|----------|-------------------|---------------------|------------------|
| **Arbitrage** | All assets auto-execute | ZRS blocked; ZEPH needs PnL >= $20 | Only ZYS discount buys |
| **Rebalancer** | Auto-execute if cost <= $50 | Manual only | Manual only |
| **Peg Keeper** | Auto-execute if profitable | Needs >= 100 bps deviation | Only discount buys >= 500 bps |
| **LP Manager** | Fee collection only | Fee collection only; wider ranges | Fee collection only; widest ranges |
