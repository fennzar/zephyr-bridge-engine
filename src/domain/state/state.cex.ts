import type { AssetId } from "@domain/types";
import type { CexState, CexMarketSnapshot, CexMarketDepthLevel } from "./types";
import {
  fetchMexcWorkerSnapshot,
  type MexcWorkerSnapshot,
  type MexcWorkerDepthLevel,
} from "@services/mexc/worker";
import { getMexcDepth } from "@services/mexc/market";

const DEFAULT_TAKER_BPS = 20;
const DEFAULT_MAKER_BPS = 10;
const DEFAULT_ZEPH_CONFIRMATIONS = 12;
const DEFAULT_USDT_CONFIRMATIONS = 6;
const DEFAULT_ZEPH_WITHDRAW_MS = 30 * 60 * 1000;
const DEFAULT_USDT_WITHDRAW_MS = 15 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const WORKER_SNAPSHOT_DEPTH_LIMIT = 200;
const REST_DEPTH_LIMIT = 200;
const MIN_ACCEPTABLE_DEPTH_LEVELS = 5;

const MARKET_DEFINITIONS: Array<{ symbol: string; base: AssetId; quote: AssetId; workerSymbol: string }> = [
  { symbol: "ZEPH_USDT", base: "ZEPH.x", quote: "USDT.x", workerSymbol: "ZEPHUSDT" },
];

export type CexStateOverrides = Partial<CexState>;

export async function buildCexState(overrides?: CexStateOverrides): Promise<CexState> {
  const base = createDefaultState();

  const snapshot = await fetchMexcWorkerSnapshot({ limit: WORKER_SNAPSHOT_DEPTH_LIMIT });
  if (snapshot) {
    await applyWorkerSnapshot(base, snapshot);
  }

  return applyOverrides(base, overrides);
}

function createDefaultState(): CexState {
  return {
    fees: {
      takerBps: DEFAULT_TAKER_BPS,
      makerBps: DEFAULT_MAKER_BPS,
      zeph: { withdrawal: 0n },
      usdt: { withdrawal: 0n },
    },
    durations: {
      deposits: {
        zephConfirmations: DEFAULT_ZEPH_CONFIRMATIONS,
        usdtConfirmations: DEFAULT_USDT_CONFIRMATIONS,
      },
      withdrawals: {
        zephEstTimeMs: DEFAULT_ZEPH_WITHDRAW_MS,
        usdtEstTimeMs: DEFAULT_USDT_WITHDRAW_MS,
      },
    },
    markets: buildDefaultMarkets(),
    watcher: {
      live: false,
      stale: true,
      lastUpdatedAt: null,
    },
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
  };
}

function buildDefaultMarkets(): Record<string, CexMarketSnapshot> {
  const entries: Record<string, CexMarketSnapshot> = {};
  for (const def of MARKET_DEFINITIONS) {
    entries[def.symbol] = createEmptyMarket(def.symbol, def.base, def.quote);
  }
  return entries;
}

function createEmptyMarket(symbol: string, base: AssetId, quote: AssetId): CexMarketSnapshot {
  return {
    symbol,
    base,
    quote,
    bid: null,
    ask: null,
    last: null,
    depth: {
      bids: [],
      asks: [],
    },
    lastUpdatedAt: null,
  };
}

function applyOverrides(base: CexState, overrides?: CexStateOverrides): CexState {
  if (!overrides) return base;

  return {
    fees: {
      takerBps: overrides.fees?.takerBps ?? base.fees.takerBps,
      makerBps: overrides.fees?.makerBps ?? base.fees.makerBps,
      zeph: {
        withdrawal: overrides.fees?.zeph?.withdrawal ?? base.fees.zeph.withdrawal,
      },
      usdt: {
        withdrawal: overrides.fees?.usdt?.withdrawal ?? base.fees.usdt.withdrawal,
      },
    },
    durations: {
      deposits: {
        zephConfirmations:
          overrides.durations?.deposits?.zephConfirmations ?? base.durations.deposits.zephConfirmations,
        usdtConfirmations:
          overrides.durations?.deposits?.usdtConfirmations ?? base.durations.deposits.usdtConfirmations,
      },
      withdrawals: {
        zephEstTimeMs:
          overrides.durations?.withdrawals?.zephEstTimeMs ?? base.durations.withdrawals.zephEstTimeMs,
        usdtEstTimeMs:
          overrides.durations?.withdrawals?.usdtEstTimeMs ?? base.durations.withdrawals.usdtEstTimeMs,
      },
    },
    markets: {
      ...base.markets,
      ...(overrides.markets ?? {}),
    },
    watcher: overrides.watcher ?? base.watcher,
    staleAfterMs: overrides.staleAfterMs ?? base.staleAfterMs,
  };
}

async function applyWorkerSnapshot(state: CexState, snapshot: MexcWorkerSnapshot): Promise<void> {
  const staleAfter = snapshot.staleAfterMs ?? state.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const lastUpdated =
    snapshot.lastUpdatedAt ??
    snapshot.depth?.ts ??
    snapshot.ticker?.ts ??
    snapshot.trades?.[0]?.ts ??
    null;

  const now = Date.now();
  const stale = lastUpdated ? now - lastUpdated > staleAfter : true;

  state.staleAfterMs = staleAfter;
  state.watcher = {
    live: snapshot.watcher.live,
    stale,
    lastUpdatedAt: lastUpdated ?? null,
  };

  let restSummary: Awaited<ReturnType<typeof getMexcDepth>> | null = null;

  for (const def of MARKET_DEFINITIONS) {
    if (!matchesWorkerSymbol(snapshot, def.workerSymbol)) continue;
    const market = state.markets[def.symbol] ?? createEmptyMarket(def.symbol, def.base, def.quote);

    const bids = toDepth(snapshot.depth?.bids);
    const asks = toDepth(snapshot.depth?.asks);
    const needsRestDepth =
      bids.length < MIN_ACCEPTABLE_DEPTH_LEVELS || asks.length < MIN_ACCEPTABLE_DEPTH_LEVELS;

    if (needsRestDepth) {
      restSummary ??= await fetchRestDepthSafe(def.workerSymbol);
      if (restSummary) {
        const restDepth = convertRestDepth(restSummary);
        if (restDepth.bids.length > 0) {
          bids.splice(0, bids.length, ...restDepth.bids);
        }
        if (restDepth.asks.length > 0) {
          asks.splice(0, asks.length, ...restDepth.asks);
        }
        if (restSummary.bestBid > 0) {
          market.bid = restSummary.bestBid;
        }
        if (restSummary.bestAsk > 0) {
          market.ask = restSummary.bestAsk;
        }
      }
    }

    const bestBid = firstPositivePrice(bids) ?? snapshot.ticker?.bid ?? market.bid ?? null;
    const bestAsk = firstPositivePrice(asks) ?? snapshot.ticker?.ask ?? market.ask ?? null;
    const latestTradePrice = (() => {
      if (snapshot.trades?.length) {
        const recent = [...snapshot.trades]
          .filter((trade) => Number.isFinite(trade.price) && trade.price > 0)
          .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        if (recent.length > 0) return recent[0].price;
      }
      if (snapshot.ticker?.bid && snapshot.ticker.bid > 0 && snapshot.ticker?.ask && snapshot.ticker.ask > 0) {
        return (snapshot.ticker.bid + snapshot.ticker.ask) / 2;
      }
      return null;
    })();

    market.bid = bestBid;
    market.ask = bestAsk;
    if (latestTradePrice != null && latestTradePrice > 0) {
      market.last = latestTradePrice;
    } else if (bestBid != null && bestAsk != null) {
      market.last = (bestBid + bestAsk) / 2;
    }
    market.depth = {
      bids,
      asks,
    };
    market.lastUpdatedAt = lastUpdated ?? market.lastUpdatedAt ?? null;

    state.markets[def.symbol] = market;
  }
}

function matchesWorkerSymbol(snapshot: MexcWorkerSnapshot, workerSymbol: string): boolean {
  const tickerSymbol = snapshot.ticker?.symbol?.toUpperCase();
  const depthSymbol = snapshot.depth?.symbol?.toUpperCase();
  if (tickerSymbol && tickerSymbol === workerSymbol) return true;
  if (depthSymbol && depthSymbol === workerSymbol) return true;
  if (snapshot.trades?.length) {
    return snapshot.trades.some((trade) => trade.symbol?.toUpperCase() === workerSymbol);
  }
  return false;
}

function toDepth(levels?: MexcWorkerDepthLevel[] | null): CexMarketDepthLevel[] {
  if (!levels) return [];
  return levels
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.qty) && level.qty > 0)
    .map((level) => ({
      price: level.price,
      amount: level.qty,
    }));
}

function firstPositivePrice(levels: Array<{ price: number; amount: number }>): number | null {
  for (const level of levels) {
    if (level.price > 0 && level.amount > 0) {
      return level.price;
    }
  }
  return null;
}

async function fetchRestDepthSafe(symbol: string) {
  try {
    return await getMexcDepth(symbol, REST_DEPTH_LIMIT);
  } catch {
    return null;
  }
}

function convertRestDepth(summary: Awaited<ReturnType<typeof getMexcDepth>>): {
  bids: CexMarketDepthLevel[];
  asks: CexMarketDepthLevel[];
} {
  const toLevels = (entries: typeof summary.bids): CexMarketDepthLevel[] =>
    entries
      .filter((entry) => Number.isFinite(entry.price) && Number.isFinite(entry.qty) && entry.qty > 0)
      .map((entry) => ({
        price: entry.price,
        amount: entry.qty,
      }));

  return {
    bids: toLevels(summary.bids),
    asks: toLevels(summary.asks),
  };
}
