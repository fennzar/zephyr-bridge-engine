import type { AssetId } from "@domain/types";
import type { CexMarketSnapshot, GlobalState } from "@domain/state/types";
import type { OperationRuntime } from "@domain/runtime/types";

/**
 * CEX timing constants.
 * - MEXC requires 20 confirmations for ZEPH deposits (~40 min at ~2 min/block).
 * - USDT deposits are faster (network dependent, assume ~5 min for ERC-20).
 * - Withdrawals are usually quick processing, but ZEPH receives have 10-block unlock.
 * - Trades are instant once order is placed.
 */
const ZEPHYR_BLOCK_TIME_MS = 2 * 60 * 1000; // ~2 minutes per block
const MEXC_ZEPH_CONFIRMATIONS = 20;
const MEXC_ZEPH_DEPOSIT_DURATION_MS = MEXC_ZEPH_CONFIRMATIONS * ZEPHYR_BLOCK_TIME_MS; // ~40 minutes
const MEXC_USDT_DEPOSIT_DURATION_MS = 5 * 60 * 1000; // ~5 minutes (ERC-20 confirmations)
const MEXC_WITHDRAWAL_PROCESSING_MS = 2 * 60 * 1000; // ~2 minutes processing
const ZEPHYR_UNLOCK_BLOCKS = 10;
const ZEPHYR_UNLOCK_DURATION_MS = ZEPHYR_UNLOCK_BLOCKS * ZEPHYR_BLOCK_TIME_MS; // ~20 minutes
const CEX_TRADE_DURATION_MS = 500; // near-instant, sub-second

export type CexOperationContext =
  | {
      direction: "deposit";
      cex: NonNullable<GlobalState["cex"]>;
    }
  | {
      direction: "withdraw";
      cex: NonNullable<GlobalState["cex"]>;
    }
  | {
      direction: "tradeCEX";
      cex: NonNullable<GlobalState["cex"]>;
      marketSymbol: string;
      market: CexMarketSnapshot;
      tradeSide: "baseToQuote" | "quoteToBase";
      stale: boolean;
    };

type CexMarketDefinition = {
  symbol: string;
  base: AssetId;
  quote: AssetId;
};

const CEX_MARKET_DEFINITIONS: CexMarketDefinition[] = [
  { symbol: "ZEPH_USDT", base: "ZEPH.x", quote: "USDT.x" },
];

function resolveMarket(
  from: AssetId,
  to: AssetId,
  state: NonNullable<GlobalState["cex"]>,
): { market: CexMarketSnapshot; tradeSide: "baseToQuote" | "quoteToBase" } | null {
  const match = CEX_MARKET_DEFINITIONS.find(
    (def) =>
      (def.base === from && def.quote === to) ||
      (def.base === to && def.quote === from),
  );
  if (!match) return null;
  const market = state.markets[match.symbol];
  if (!market) return null;
  const tradeSide: "baseToQuote" | "quoteToBase" = match.base === from ? "baseToQuote" : "quoteToBase";
  return { market, tradeSide };
}

function isMarketFresh(state: NonNullable<GlobalState["cex"]>, market: CexMarketSnapshot): boolean {
  if (!state.watcher?.live) return false;
  if (state.watcher?.stale) return false;
  const staleAfter = state.staleAfterMs ?? 0;
  const updated = market.lastUpdatedAt ?? state.watcher?.lastUpdatedAt ?? null;
  if (!updated) return false;
  if (staleAfter <= 0) return true;
  return Date.now() - updated <= staleAfter;
}

function hasUsableDepth(
  market: CexMarketSnapshot,
  side: "baseToQuote" | "quoteToBase",
): boolean {
  const depth = market.depth;
  if (!depth) return false;
  const levels = side === "baseToQuote" ? depth.bids : depth.asks;
  if (!levels || levels.length === 0) return false;
  return levels.some((level) => level.price > 0 && level.amount > 0);
}

/**
 * Runtime for depositing funds into the CEX.
 * Duration varies by asset: ZEPH requires ~20 confirmations (~40 min),
 * USDT (ERC-20) is faster (~5 min).
 */
export const depositRuntime: OperationRuntime<CexOperationContext> = {
  id: "deposit",

  enabled(_from: AssetId, _to: AssetId, _st: GlobalState): boolean {
    return Boolean(_st.cex);
  },

  buildContext(_from: AssetId, _to: AssetId, st: GlobalState): CexOperationContext | null {
    if (!st.cex) return null;
    return { direction: "deposit", cex: st.cex };
  },

  durationMs(from: AssetId, _to: AssetId, st: GlobalState): number {
    // ZEPH deposits require more confirmations than USDT.
    if (from === "ZEPH.n" || from === "ZEPH.x") {
      return MEXC_ZEPH_DEPOSIT_DURATION_MS;
    }
    return MEXC_USDT_DEPOSIT_DURATION_MS;
  },
};

/**
 * Runtime for withdrawing funds from the CEX.
 * ZEPH withdrawals incur a 10-block unlock on the native network after receipt.
 * USDT withdrawals are faster but still have CEX processing time.
 */
export const withdrawRuntime: OperationRuntime<CexOperationContext> = {
  id: "withdraw",

  enabled(_from: AssetId, _to: AssetId, _st: GlobalState): boolean {
    return Boolean(_st.cex);
  },

  buildContext(_from: AssetId, _to: AssetId, st: GlobalState): CexOperationContext | null {
    if (!st.cex) return null;
    return { direction: "withdraw", cex: st.cex };
  },

  durationMs(from: AssetId, to: AssetId, st: GlobalState): number {
    // CEX processing + network confirmation.
    // ZEPH withdrawals to native have 10-block unlock afterward.
    const baseProcessing = MEXC_WITHDRAWAL_PROCESSING_MS;
    if (to === "ZEPH.n") {
      return baseProcessing + ZEPHYR_UNLOCK_DURATION_MS;
    }
    return baseProcessing;
  },
};

/**
 * Runtime for trading inside the CEX.
 * Trades execute near-instantly once the order is placed.
 */
export const tradeCexRuntime: OperationRuntime<CexOperationContext> = {
  id: "tradeCEX",

  enabled(_from: AssetId, _to: AssetId, _st: GlobalState): boolean {
    if (!_st.cex) return false;
    const resolved = resolveMarket(_from, _to, _st.cex);
    if (!resolved) return false;
    const fresh = isMarketFresh(_st.cex, resolved.market);
    const hasDepth = hasUsableDepth(resolved.market, resolved.tradeSide);
    return fresh && hasDepth;
  },

  buildContext(_from: AssetId, _to: AssetId, st: GlobalState): CexOperationContext | null {
    if (!st.cex) return null;
    const resolved = resolveMarket(_from, _to, st.cex);
    if (!resolved) return null;
    const stale = !isMarketFresh(st.cex, resolved.market) || !hasUsableDepth(resolved.market, resolved.tradeSide);
    return {
      direction: "tradeCEX",
      cex: st.cex,
      marketSymbol: resolved.market.symbol,
      market: resolved.market,
      tradeSide: resolved.tradeSide,
      stale,
    };
  },

  durationMs(_from: AssetId, _to: AssetId, _st: GlobalState): number {
    // CEX trades are near-instant (order placement + matching).
    return CEX_TRADE_DURATION_MS;
  },
};
