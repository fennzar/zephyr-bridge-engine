## Domain Architecture Scope

This note summarizes how venue state, runtimes, and quoting currently fit together, plus where we are headed next. The recent work split “lightweight” state quotes from the authoritative on-chain quoter so we can rely on chain-priced outputs by default while still keeping offline tooling around for analysis.

### Current Responsibilities

- **State snapshots (`state.*`)**
  - Hydrate venue-specific data (Zephyr reserve policy, bridge params, Uniswap V4 slot0/liquidity, CEX fees) and compose it into a unified `GlobalState`.
  - All RPC/multicall usage lives here. We now enrich EVM pools with V4 state-view data (sqrt price, tick, liquidity) so downstream code has the same slot0 information the contracts use.

- **Operation runtimes (`runtime.*`)**
  - Stateless adapters that answer “can we perform this operation right now?” for each venue (`swapEVM`, `nativeMint`, `wrap`, `tradeCEX`, …).
  - Expose mechanics (fees, timing, inventory availability) but do not decide sizing.

- **Quoters (`quoting.*`)**
  - **`quoting.onchain.swap.ts`** – canonical Uniswap V4 quoter integration used by APIs and the UI. Every swap quote goes through the contract so outputs always match what the router would execute.
  - **`quoting.state.swap.ts`** – state-based swap helper used by the quoter playground and pathing evaluator for offline analysis.
  - Bridge / Zephyr / CEX placeholders remain to be filled in with venue-specific quoting as we expand coverage.

- **Inventory workflows (`inventory/*`)**
  - Graph + pathing logic, rebalancing/arbitrage orchestration, and other higher-level flows consume runtimes and quoters to plan actions without embedding venue-specific assumptions.

### Directory Layout (current snapshot)

```
src/domain/
  state/
    state.builder.ts
    state.zephyr.ts
    state.evm.ts      # now enriches pools via V4 state view
    state.bridge.ts
    state.cex.ts
    types.ts
  runtime/
    runtime.zephyr.ts
    runtime.evm.ts
    runtime.bridge.ts
    runtime.cex.ts
    operations.ts
  quoting/
    quoting.index.ts
    quoting.onchain.swap.ts
    quoting.state.swap.ts
    quoting.bridge.ts
    quoting.zephyr.ts
    quoting.cex.ts
    types.ts
  inventory/
    graph.ts
    workflows/
      rebalance.ts
      arbitrage.ts
      settlement.ts
  scope.md (this document)
```

### API / UI Integration

- `/api/quoters` and the Quoter Playground now call `quoteSwapOnchain` exclusively so operators always see true on-chain numbers (amount out, gas, direction). A collapsible debug panel still exposes the raw payload for inspection.
- The runtime inspector (`/runtime`) shows the enriched pool state (sqrtPriceX96, tick, liquidity) provided by the updated EVM snapshot.

### TODO / Next Steps

1. **Additional quoting adapters**
   - Implement bridge, Zephyr, and CEX quoters using venue runtimes so we can expand beyond EVM swaps.
2. **Optional caching / batching**
   - Cache recent on-chain quotes or batch multicalls so the API stays responsive under heavier load.
3. **State-based simulation (optional)**
   - If we want offline sizing, port Uniswap V4 swap math (multiple ticks/segments) into the `quoting.state` helper so it can mirror contract execution more closely.
4. **Risk / policy integration**
   - Layer risk limits, per-trade caps, and slip guards on top of the on-chain outputs before inventory workflows consume them.
5. **Multi-hop routing support**
   - Extend quoters/runtimes to evaluate multi-hop paths instead of single-pool swaps only.
6. **Testing & monitoring**
   - Add regression tests comparing state vs on-chain outputs, and surface telemetry (quote latency, failure rates) for observability.

Sticking to this structure keeps venue-specific complexity in the right layer and makes it easy to plug in additional strategies, routing logic, or execution tooling without entangling concerns.
