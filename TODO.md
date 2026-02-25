# TODO Catalog

> Updated: 2026-02-24 (post refactoring round).

## Strategy Status

All four strategies are **fully implemented** (evaluate → buildPlan → shouldAutoExecute):

| Strategy | File | Status |
|----------|------|--------|
| ArbitrageStrategy | `src/domain/strategies/arbitrage.ts` | Complete — RR-aware, spot/MA spread checks, native + CEX close paths |
| RebalancerStrategy | `src/domain/strategies/rebalancer.ts` | Complete — cross-venue rebalancing (EVM ↔ native ↔ CEX) |
| PegKeeperStrategy | `src/domain/strategies/pegkeeper.ts` | Complete — ZSD peg monitoring, premium/discount correction |
| LPManagerStrategy | `src/domain/strategies/lpmanager.ts` | Complete — out-of-range detection, fee collection, repositioning |

Execution dispatch covers all 11 operation types (swapEVM, tradeCEX, nativeMint, nativeRedeem, wrap, unwrap, deposit, withdraw, lpMint, lpBurn, lpCollect).

---

## Critical — Blocks Live Execution

| File | Function | Description |
|------|----------|-------------|
| `src/services/mexc/live.ts` | `getDepositAddress()` | **Throws unimplemented.** MEXC deposit address endpoint (`GET /api/v3/capital/deposit/address`) not wired. Blocks live CEX deposits. |
| `src/services/mexc/live.ts` | `requestWithdraw()` | **Throws unimplemented.** MEXC withdrawal endpoint (`POST /api/v3/capital/withdraw`) not wired. Blocks live CEX withdrawals. |
| `src/services/bridge/executor.ts` | `checkVoucherStatus()` | **Returns hardcoded `"unknown"`.** No real bridge contract/API query. Cannot track wrap operation progress. |

## High

| File | Function | Description |
|------|----------|-------------|
| `src/domain/strategies/arbitrage.execution.ts` | — | **USD-weighted exposure**: `computeAssetExposure` uses token-count-based exposure, not USD-weighted. Sufficient for now (risk limits default to disabled) but needs USD pricing for mainnet. |
| `src/domain/strategies/arbitrage.execution.ts` | `lookupSwapContext()` | **Pool hooks from config**: hardcodes hooks to zero-address. When custom hooks are deployed, read from pool config/addresses.local.json. |

## Medium

| File | Function | Description |
|------|----------|-------------|
| `src/services/mexc/live.ts` | `getRecentEvents()` | **Returns `[]`.** No order/deposit/withdraw history fetched. Audit trail missing in live mode. |
| `src/services/mexc/paperCexBridge.ts` | `getRecentEvents()` | **Returns `[]`.** Could fetch from PaperCEX trade history for completeness. |
| `src/domain/pathing/evaluator.ts` | `quoteDeposit()` | **Placeholder 1:1 conversion.** No bridge fee or timing model. Deposit quotes inaccurate. |
| `src/services/evm/uniswapV4/persistence.ts` | `saveDonate()` | **Logs only, no persistence.** Donate events not tracked in DB. |
| `src/domain/strategies/lpmanager.ts` | `estimatePositionValue()` | **Rough estimate.** Uses state prices which may be stale; needs proper price calc for production. |
| `apps/web/app/positions/page.tsx` | — | **Owner address**: Uses zero-address placeholder — should read from session or wallet config. |
| `src/domain/strategies/arbitrage.execution.ts` | `getStepPrice()` | **CEX close amount estimation**: Only looks at bid/ask mid — should account for order book depth for larger clip sizes. |
| `src/domain/execution/execution.dispatch.ts` | LP paper mode | **Paper mode LP uses amountIn as amountOut**: Rough approximation. Should simulate based on pool state. |

## Low

| File | Function | Description |
|------|----------|-------------|
| `apps/engine/src/status.ts` | `checkStatus()` | **Watcher health pinging**: Infers status from state availability instead of pinging watcher HTTP endpoints. |
| `src/domain/runtime/runtime.bridge.ts` | `durationMs()` | **Bridge duration**: wrap/unwrap always returns 20-min default (10 blocks × 2 min). Could be dynamic based on network conditions. |
| `apps/web/app/shared/assetMetadata.ts` | — | **CEX asset decimals**: `ZEPH.x` precision set to 8 — confirm MEXC still reports 8 decimals. |

---

## Recently Completed

| Item | Commit |
|------|--------|
| **Codebase refactoring**: Split 16 monolithic files (>500 lines) into ~35 focused modules across domain, services, and web layers. Shared types file, cleaned unused imports. All 190 tests pass. | `a305e0e` |
| **Cleanup round**: Freshness checks for EVM/CEX data, seeded status from DB, remove legacy `addLiquidity()` no-op, delete dead worker test | — |
| **Engine gaps fix**: tickSpacing/hooks from pool config, per-step amount chaining, risk exposure, dead code cleanup, paper CEX price | `58ca4d3` |
| **Pool seeder bugs**: wallet RPC V2 params, EIP-712 claim flow, bridge account creation, pool scan | `58ca4d3` |
| LP executor: `executeLpMint`, `executeLpBurn`, `executeLpCollect` — full V4 PositionManager implementation with Permit2 approvals | `d3af544` |
| Concentrated liquidity math library (`liquidityMath.ts`) with 61 unit tests | `d3af544`, `0cbc5f9` |
| Pool seeding service (`poolSeeder.ts`) — wrap→claim→LP orchestration | `d3af544` |
| Bridge API client (`apiClient.ts`) — health, claims, polling | `d3af544` |
| Engine CLI `setup` command (dry-run, skip-wrap, pool filter) | `d3af544` |
| Web API `/api/engine/setup` endpoint (seed + status actions) | `d3af544` |
| Pool plan config in `addresses.local.json` (5 pools with band definitions) | `0cbc5f9` |
| Factory: `createBridgeApiClient()`, `BRIDGE_API_URL` env var | `d3af544` |
