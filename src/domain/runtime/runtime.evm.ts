import type { AssetId } from "@domain/types";
import type { EvmPool, GlobalState } from "@domain/state/types";
import type { OperationRuntime } from "@domain/runtime/types";
import { DEFAULT_EVM_POOL_STALE_AFTER_MS } from "@domain/state/state.evm";

const MAX_DECIMALS_FOR_RESERVES = 18;
const DEFAULT_BLOCK_TIME_MS = 12_000; // 12s heuristic
const APPROX_SWAP_GAS_LIMIT = 160_000n;

type PoolDirection = "baseToQuote" | "quoteToBase";

function poolKey(a: AssetId, b: AssetId): string {
  return [a, b].sort().join("::");
}

function toTokenUnits(total: number | null | undefined, decimals: number): bigint | null {
  if (total == null || !Number.isFinite(total) || total <= 0) return null;
  if (decimals < 0 || decimals > MAX_DECIMALS_FOR_RESERVES || decimals > 20) return null;
  try {
    const fixed = total.toFixed(decimals);
    const [intPartRaw, fracPartRaw = ""] = fixed.split(".");
    const fraction = fracPartRaw.padEnd(decimals, "0");
    const digits = `${intPartRaw.replace(/[^0-9-]/g, "")}${fraction}`;
    return BigInt(digits);
  } catch {
    return null;
  }
}

function resolvePoolContext(
  st: GlobalState,
  from: AssetId,
  to: AssetId,
): { pool: EvmPool; direction: PoolDirection } | null {
  const evm = st.evm;
  if (!evm?.pools) return null;

  const entry = evm.pools[poolKey(from, to)];
  if (!entry) return null;

  if (entry.base === from && entry.quote === to) {
    return { pool: entry, direction: "baseToQuote" };
  }
  if (entry.base === to && entry.quote === from) {
    return { pool: entry, direction: "quoteToBase" };
  }
  return null;
}

function gasEstimateWei(st: GlobalState): bigint | undefined {
  const gasPrice = st.evm?.gasPriceWei;
  if (!gasPrice || gasPrice <= 0n) return undefined;
  return gasPrice * APPROX_SWAP_GAS_LIMIT;
}

function getPoolReserves(context: { pool: EvmPool; direction: PoolDirection }): { reserveIn: bigint; reserveOut: bigint } | null {
  const { pool, direction } = context;
  const baseUnits = toTokenUnits(pool.totalBase ?? null, pool.baseDecimals);
  const quoteUnits = toTokenUnits(pool.totalQuote ?? null, pool.quoteDecimals);
  if (baseUnits == null || quoteUnits == null) return null;
  if (direction === "baseToQuote") {
    return { reserveIn: baseUnits, reserveOut: quoteUnits };
  }
  return { reserveIn: quoteUnits, reserveOut: baseUnits };
}

function isPoolFresh(pool: EvmPool, st: GlobalState): boolean {
  const staleAfter = st.evm?.staleAfterMs ?? DEFAULT_EVM_POOL_STALE_AFTER_MS;
  if (!staleAfter || staleAfter <= 0) return true;
  const watcherActive = st.evm?.watcher?.live ?? false;
  const lastSwapAtMs = pool.lastSwapAtMs;
  if (!Number.isFinite(lastSwapAtMs)) return watcherActive;
  return watcherActive || Date.now() - (lastSwapAtMs ?? 0) <= staleAfter;
}

export interface SwapEvmContext {
  pool: EvmPool;
  direction: PoolDirection;
  reserves?: { reserveIn: bigint; reserveOut: bigint };
  gasEstimateWei?: bigint;
  watcherStale: boolean;
}

export const swapEvmRuntime: OperationRuntime<SwapEvmContext> = {
  id: "swapEVM",

  enabled(from: AssetId, to: AssetId, st: GlobalState): boolean {
    const context = resolvePoolContext(st, from, to);
    if (!context) return false;

    const rate =
      context.direction === "baseToQuote" ? context.pool.price : context.pool.priceInverse;
    if (!(rate != null && Number.isFinite(rate) && rate > 0)) return false;

    if (!isPoolFresh(context.pool, st)) return false;

    if (
      (context.pool.totalBase != null && context.pool.totalBase <= 0) ||
      (context.pool.totalQuote != null && context.pool.totalQuote <= 0)
    ) {
      return false;
    }

    return true;
  },

  buildContext(from: AssetId, to: AssetId, st: GlobalState): SwapEvmContext | null {
    const context = resolvePoolContext(st, from, to);
    if (!context) return null;

    const { pool } = context;
    if (!isPoolFresh(pool, st)) return null;
    if (
      (pool.totalBase != null && pool.totalBase <= 0) ||
      (pool.totalQuote != null && pool.totalQuote <= 0)
    ) {
      return null;
    }

    const reserves = getPoolReserves(context);
    return {
      pool,
      direction: context.direction,
      reserves: reserves ?? undefined,
      gasEstimateWei: gasEstimateWei(st),
      watcherStale: Boolean(st.evm?.watcher?.stale),
    };
  },

  durationMs(): number {
    return DEFAULT_BLOCK_TIME_MS;
  },
};
