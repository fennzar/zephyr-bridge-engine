# Execution and Risk

## Operation Types

The engine supports 11 operation types, each dispatched to the appropriate venue handler:

| OpType | Venue | Description |
|--------|-------|-------------|
| `swapEVM` | evm | Swap on Uniswap V4 |
| `tradeCEX` | cex | Market order on MEXC |
| `nativeMint` | native | Mint ZSD/ZRS/ZYS on Zephyr chain |
| `nativeRedeem` | native | Redeem ZSD/ZRS/ZYS on Zephyr chain |
| `wrap` | evm | Wrap native asset to EVM (ZEPH.n -> WZEPH.e) |
| `unwrap` | evm | Unwrap EVM asset to native (WZEPH.e -> ZEPH.n) |
| `deposit` | cex | Deposit to CEX |
| `withdraw` | cex | Withdraw from CEX |
| `lpMint` | evm | Create or add to LP position |
| `lpBurn` | evm | Remove liquidity from LP position |
| `lpCollect` | evm | Collect accrued LP fees |

## Execution Engine

`ExecutionEngine` in `src/domain/execution/engine.ts` runs plans by dispatching each step to its venue handler sequentially. Execution stops on the first failure unless in dry-run mode.

Each step threads its actual output to the next step's input:

```
Step 1 result.amountOut -> Step 2 input.amountIn -> Step 3 ...
```

### Dispatch mapping

`dispatchToVenue()` in `src/domain/execution/execution.dispatch.ts` routes each operation to a venue executor:

| Operations | Executor |
|------------|----------|
| `swapEVM`, `lpMint`, `lpBurn`, `lpCollect`, `wrap`, `unwrap` | `EvmExecutor` / `BridgeExecutor` |
| `tradeCEX`, `deposit`, `withdraw` | `IMexcClient` |
| `nativeMint`, `nativeRedeem` | `ZephyrWalletClient` |

### Venue executors

Created by `createVenueExecutors(mode)` in `src/domain/execution/factory.ts`:

```typescript
interface VenueExecutors {
  mexc: IMexcClient;
  evm: EvmExecutor;
  bridge: BridgeExecutor;
  zephyr: ZephyrWalletClient;
}
```

Factory functions:

| Factory | Behavior |
|---------|----------|
| `createMexcClient(mode)` | Live mode + `!MEXC_PAPER`: real MEXC API. Otherwise: `CexWalletClient` with accounting-only trades |
| `createEvmExecutor(key?)` | viem public + wallet clients against the network from `ZEPHYR_ENV` |
| `createZephyrWalletClient()` | RPC client to Zephyr wallet-engine |
| `createBridgeExecutor(zephyr, evm)` | Coordinates wrap/unwrap between Zephyr and EVM |

## Execution Modes

| Mode | Infrastructure | Side Effects | Paper Simulation |
|------|---------------|--------------|------------------|
| **paper** | None required | Zero | EVM: 0.3% slippage. CEX: 0.1% slippage. Bridge/native: 1:1 pass-through |
| **devnet** | Local Anvil + devnet wallets | Real transactions on local chain | Fake orderbook for CEX; real EVM/Zephyr |
| **live** | Production APIs + mainnet/sepolia | Real transactions everywhere | None |

### Timing simulation

When `simulateTiming` is enabled (paper mode), realistic delays are applied:

| Operation | Delay |
|-----------|-------|
| MEXC ZEPH deposit | 40 minutes (20 confirmations at 2 min) |
| MEXC USDT deposit | 5 minutes (ERC-20) |
| MEXC withdrawal | 2 minutes |
| Zephyr unlock | 20 minutes (10 blocks) |
| Bridge confirmations | 20 minutes (10 blocks) |
| EVM confirmation | 12 seconds (1 block) |
| CEX trade | 500 ms |

Instant mode (default) uses zero delays for all operations.

## Risk Controls

### Circuit Breaker

`CircuitBreaker` in `src/domain/risk/circuitBreaker.ts` tracks consecutive failures and cumulative losses. It is in-memory only (not DB-persisted).

**State:**

```typescript
interface CircuitBreakerState {
  isOpen: boolean;
  openReason?: string;
  openedAt?: Date;
  cumulativeLossUsd: number;
  consecutiveFailures: number;
  totalOperations: number;
  successfulOperations: number;
  lastOperationAt?: Date;
}
```

**Trip conditions:**

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Consecutive failures | `maxConsecutiveFailures` (default 3) | Opens circuit: "Too many consecutive failures" |
| Daily cumulative loss | `maxDailyLossUsd` (default $500) | Opens circuit: "Daily loss limit exceeded" |

**State transitions:**

- `recordSuccess(pnlUsd)`: Resets consecutive failures. If PnL is negative, adds loss to cumulative total and checks thresholds
- `recordFailure(error?)`: Increments consecutive failures, checks thresholds
- `canExecute()`: Returns `{allowed: false, reason}` if circuit is open
- `resetDaily()`: Zeros cumulative loss (call at start of each day)

### Risk Limits

`RiskLimits` in `src/domain/risk/limits.ts`:

```typescript
const DEFAULT_RISK_LIMITS = {
  enabled: false,              // Disabled by default (testnet safety)
  maxOperationUsd: 1000,       // $1,000 per operation
  maxDailyLossUsd: 500,        // $500 max loss per day
  maxConsecutiveFailures: 3,   // 3 failures -> halt
  maxAssetExposurePct: 30,     // 30% max inventory in one asset
  cooldownMs: 60_000,          // 60 second cooldown per opportunity
  staleDataThresholdMs: 60_000 // 60 second stale data threshold
};
```

When enabled, `checkOperationAllowed()` validates:
1. Operation size does not exceed `maxOperationUsd`
2. Asset exposure does not exceed `maxAssetExposurePct`

Risk controls are enabled via `RISK_CONTROLS_ENABLED=true` in the environment.

## Execution Flow

When a plan is executed (either auto-execute or from the approved queue):

1. **Circuit breaker check**: If the circuit is open, the plan is blocked and recorded as a blocked execution
2. **Risk limit check**: Validate operation size and asset exposure against limits
3. **Step-by-step execution**: Each step runs sequentially. On failure, execution stops and remaining steps are skipped. Each step's output amount feeds into the next step's input
4. **Circuit breaker update**: On success, `recordSuccess(pnlUsd)`. On failure, `recordFailure(error)`
5. **History recording**: The full result (plan, step results, PnL, gas used, duration) is persisted to `ExecutionHistory`

## Manual Approval Flow

### Queuing

When `manualApproval` is true (default), plans are inserted into the `OperationQueue` table:

```typescript
await prisma.operationQueue.create({
  data: {
    strategy: plan.strategy,
    status: "pending",
    priority: calculatePriority(plan),
    plan: serializedPlan,
  },
});
```

Priority is computed from urgency (critical +100, high +50, medium +25) plus expected PnL (capped at +50).

### Review via API

The web dashboard at `GET /api/engine/queue` lists pending operations. Actions via `POST /api/engine/queue`:

| Action | From Status | To Status | Effect |
|--------|------------|-----------|--------|
| `approve` | pending | approved | Marks for execution next cycle |
| `reject` | pending | rejected | Permanently declined |
| `cancel` | pending or approved | cancelled | Withdrawn |
| `retry` | failed | pending | Re-queued for review |

### Processing

`processApprovedQueue()` runs each engine cycle:

1. Fetch operations with `status: "approved"`, ordered by `priority` descending
2. Take up to `maxOperationsPerCycle` (default 5)
3. For each: set status to `"executing"`, run the plan, set status to `"completed"` or `"failed"`

### Status flow

```
pending -> approved -> executing -> completed
   |                                    |
   +-> rejected                    failed -> (retry) -> pending
   |
   +-> cancelled
```

## Auto-Execute

For auto-execution (when `manualApproval` is false), each strategy's `shouldAutoExecute()` is the final gate. Common checks across strategies:

1. `manualApproval` must be `false`
2. Expected PnL meets the minimum threshold
3. [RR mode](architecture.md#reserve-ratio-and-rr-modes) allows the operation for the given asset
4. Strategy-specific checks (spread gates, cost limits, etc.)

See [Strategies](strategies.md) for per-strategy auto-execute rules.

## Engine Settings

The `EngineSettings` model (singleton row in DB) controls runtime behavior:

| Field | Default | Description |
|-------|---------|-------------|
| `autoExecute` | false | Whether the engine executes approved plans automatically |
| `manualApproval` | true | Require manual approval before execution |
| `cooldownMs` | 60,000 | Minimum time between same-opportunity executions |

These can be updated via the web dashboard and take effect on the next cycle.
