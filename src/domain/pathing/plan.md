# Pathing + Quoter Integration Plan

## Objectives
- Extend the existing inventory path explorer with a parallel system that understands live domain state, runtimes, and quoters.
- Preserve the current inventory path and prep pages as-is while introducing new pages that surface quoter-aware routing.
- Prepare the groundwork for later inventory-aware sizing by scaffolding where inventory data and runtime allowances will plug in.

## Guiding Principles
- Reuse the canonical operation graph from `@domain/inventory/graph` so the new tooling stays consistent with existing paths.
- Treat runtime availability and quote policy decisions as first-class signals when ranking paths.
- Keep the new modules self-contained under `@domain/pathing` so inventory tooling can adopt them incrementally.
- Maintain clear extension points for inventory balances, leg ordering heuristics, and policy tuning.

## Phase 1 Scope (current task)
1. **Domain scaffolding**
   - Introduce `@domain/pathing` types for quoter-aware path steps, evaluation summaries, and ranking metadata.
   - Wire the module to call runtimes/quoters, deriving allowance status (policy + runtime) and fee/gas estimates per hop.
   - Provide helper utilities to aggregate path-level stats (allowed flags, total fees, warnings) without relying on inventory.
   - Extend the scaffolding to cover arbitrage leg preparation so open/close steps can pick quoter-ranked inventory paths.
   - Track per-asset inventory deltas, gas, and fee costs, converting to USD to rank paths by net cost.
2. **Front-end surface**
   - Add new dashboard pages that list quoter-enriched paths while leaving the existing inventory tools untouched.
   - Present paths ordered by allowance status first, then by effective fee burden, and expose hop details (quotes, warnings, policies).
   - Allow operators to filter by source/target assets and toggle between amount-in and amount-out drills.
3. **Future hooks**
   - Document placeholders for inventory sizing, policy overrides, and runtime duration data so follow-up work can slot in quickly.

## Out of Scope (for now)
- Consuming real inventory balances or adjusting sizing based on holdings.
- Persisting operator preferences or caching results server-side.
- Rebuilding the arbitrage dashboard; that will follow once the new pathing primitives settle.

## Open Items & Follow Ups
- Decide how to share fee/allowance heuristics between runtime policy and inventory sizing once inventory data lands.
- Flesh out bridge/cex runtime fee math so fee ordering reflects production costs.
- Integrate the quoter-aware paths into the arbitrage execution planner after inventory hooks are ready.
