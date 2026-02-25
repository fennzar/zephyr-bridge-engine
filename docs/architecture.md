# Architecture

## Layers

The codebase is split into four layers, enforced by path aliases defined in `tsconfig.base.json`:

| Alias | Path | Responsibility |
|-------|------|----------------|
| `@shared` | `src/shared/` | Zod-validated env loader, formatting, logging utilities |
| `@domain` | `src/domain/` | Pure business logic -- state, strategies, execution, inventory. No I/O |
| `@services` | `src/services/` | External integrations: viem (EVM), MEXC REST/WS, Zephyr RPC, Bridge |
| `@infra` | `src/infra/` | Prisma client and DB persistence helpers |

Dependencies flow downward: `shared <- domain <- services <- infra`. Domain code never imports from services or infra directly.

## Applications

Three apps share the core `src/` layer:

| App | Location | Purpose |
|-----|----------|---------|
| **Engine** | `apps/engine/` | CLI (Commander). Runs the main evaluate-plan-execute loop |
| **Watchers** | `apps/watchers/` | Three data feed processes: EVM (Uniswap V4), MEXC (ticker stream), Zephyr (reserve poller) |
| **Web** | `apps/web/` | Next.js 15 dashboard on port 7000. Monitoring, queue management, manual approval UI |

## Engine Cycle

`BridgeEngine.runCycle()` in `apps/engine/src/engine.ts` executes these steps on each iteration:

### 1. Load EngineSettings

Queries the `EngineSettings` table (singleton row, id `"singleton"`). DB values override CLI flags for `autoExecute`, `manualApproval`, and `cooldownMs`. Gracefully defaults if the table is empty.

### 2. Build Global State

`buildGlobalState()` aggregates snapshots from all venues into a single `GlobalState` object (see [State Model](#global-state) below).

### 3. Freshness Checks

Each data source has a staleness threshold. If any source is too old, the cycle is skipped:

| Source | Threshold | Rationale |
|--------|-----------|-----------|
| EVM (watcher) | 2 minutes | On-chain data should be near-realtime |
| CEX (MEXC) | 1 minute | Ticker stream updates frequently |
| Zephyr (reserve) | 5 minutes | Block time is ~2 minutes |

The Zephyr reserve must also be present -- missing reserve data skips the cycle.

### 4. Load Inventory Snapshot

`loadInventorySnapshot()` aggregates balances from all venues (EVM wallets, paper ledgers, Zephyr wallet, CEX accounts) into an `InventorySnapshot`.

### 5. Evaluate and Plan

For each enabled strategy:

1. `strategy.evaluate(globalState, inventory)` produces `StrategyOpportunity[]`
2. For each opportunity, check cooldown (skip if same opportunity executed within `cooldownMs`)
3. `strategy.buildPlan(opportunity, globalState, inventory)` produces an `OperationPlan`
4. If `manualApproval` is true: queue the plan for dashboard review
5. Else if `strategy.shouldAutoExecute(plan, config)` passes: execute immediately
6. Otherwise: log that auto-execute criteria were not met

### 6. Process Approved Queue

`processApprovedQueue()` fetches operations with status `"approved"` from the `OperationQueue` table, ordered by priority (descending), and executes up to `maxOperationsPerCycle` (default 5).

### 7. Sync Inventory to DB

`syncInventoryToDb(inventory)` upserts `InventoryBalance` records so the dashboard can display current holdings.

## Global State

```typescript
interface GlobalState {
  zephyr: ZephyrState;
  bridge?: BridgeState;
  evm?: EvmState;
  cex?: CexState;
}
```

### ZephyrState

Contains the full reserve snapshot (`ReserveState`), protocol fee schedule, and unlock durations:

```typescript
interface ZephyrState {
  height: number;
  reserve: ReserveState;
  feesBps: {
    convertZSD: number;   // 10 (0.10%)
    convertZRS: number;   // 100 (1.00%)
    convertZYS: number;   // 10 (0.10%)
  };
  durations: {
    unlockBlocks: number;      // 10
    estUnlockTimeMs: number;   // 1,200,000 (20 minutes)
  };
}
```

`ReserveState` carries reserve ratio, ZEPH/USD spot price, per-asset conversion rates (spot, moving average, mint, redeem), circulating supply for ZSD/ZRS/ZYS, ZEPH in reserve, and mint/redeem policy flags.

### EvmState

```typescript
interface EvmState {
  gasPriceWei?: bigint;
  staleAfterMs?: number;
  watcher?: EvmWatcherSnapshot;
  pools: Record<string, EvmPool>;
}
```

Each `EvmPool` carries price, liquidity, TVL, tick state, depth samples, and metadata needed for quoting and routing.

### CexState

```typescript
interface CexState {
  fees: { takerBps: number; makerBps: number; ... };
  durations: { deposits: {...}; withdrawals: {...} };
  markets: Record<string, CexMarketSnapshot>;
  watcher?: CexWatcherSnapshot;
}
```

Each `CexMarketSnapshot` carries bid/ask/last prices and optional order book depth.

### BridgeState

Wrap and unwrap fee/minimum parameters from the bridge API.

## Asset System

Six base assets produce 12 `AssetId` values via venue suffixes:

| Suffix | Venue | Examples |
|--------|-------|----------|
| `.e` | EVM | `ETH.e`, `USDT.e`, `WZEPH.e`, `WZSD.e`, `WZRS.e`, `WZYS.e` |
| `.n` | Native (Zephyr) | `ZEPH.n`, `ZSD.n`, `ZRS.n`, `ZYS.n` |
| `.x` | CEX (MEXC) | `ZEPH.x`, `USDT.x` |

### Decimals

| Asset | Decimals |
|-------|----------|
| ETH.e | 18 |
| USDT.e, USDT.x | 6 |
| ZEPH.x | 8 |
| All wrapped (.e) and native (.n) Zephyr assets | 12 |

Asset metadata (decimals, venue, default balance source) is defined in `src/domain/core/assets.ts` via a central `METADATA_LIST`. Helper functions (`getAssetDecimals`, `getAssetVenue`, `getAssetBase`, etc.) provide typed lookups.

## Reserve Ratio and RR Modes

The reserve ratio (RR) measures the health of the Zephyr protocol. It is stored as a decimal where `4.0` = 400%.

`determineRRMode()` in `src/domain/strategies/types.ts`:

| Mode | Condition | Behavior |
|------|-----------|----------|
| **normal** | RR >= 4.0 (400%) | All operations enabled, standard thresholds |
| **defensive** | 2.0 <= RR < 4.0 (200-400%) | Limited minting, tighter auto-execute rules |
| **crisis** | RR < 2.0 (below 200%) | Most auto-execution blocked, manual approval required |

Every strategy adapts its thresholds, clip sizes, and auto-execute criteria based on the current RR mode. See [Strategies](strategies.md) for per-strategy behavior.

## Inventory Model

`InventorySnapshot` aggregates balances across all venues:

```typescript
interface InventorySnapshot {
  balances: Partial<Record<AssetId, number>>;  // All 12 assets
  totals: Partial<Record<AssetBase, number>>;  // Summed per base asset
  options: {
    includeEvm: boolean;
    includePaperMexc: boolean;
    includePaperZephyr: boolean;
  };
}
```

Balance sources are mapped by venue:

| Source | AssetIds |
|--------|----------|
| EVM wallet (viem `balanceOf`) | ETH.e, USDT.e, WZSD.e, WZEPH.e, WZRS.e, WZYS.e |
| Zephyr wallet RPC | ZEPH.n, ZSD.n, ZRS.n, ZYS.n |
| CEX (real wallets or paper ledger) | ZEPH.x, USDT.x |

## Strategy Registry

Strategies are loaded by ID from a fixed registry:

```typescript
const STRATEGY_REGISTRY: Record<string, () => Strategy> = {
  arb:       () => new ArbitrageStrategy(),
  rebalance: () => new RebalancerStrategy(),
  peg:       () => new PegKeeperStrategy(),
  lp:        () => new LPManagerStrategy(),
};
```

All implement the `Strategy` interface: `evaluate()`, `buildPlan()`, `shouldAutoExecute()`. See [Strategies](strategies.md) for details.
