import type {
  DepthLevel,
  MarketSummary,
  MexcTickerSnapshot,
  MexcTradeSnapshot,
} from "@/types/api";

// ── Inline types ────────────────────────────────────────

export type DepthState = {
  bids: DepthLevel[];
  asks: DepthLevel[];
  ts: number;
};

export type PaperBalance = {
  available: number;
  hold: number;
};

export type PaperAccount = {
  balances: Record<string, PaperBalance>;
  events: import("@/types/api").PaperEvent[];
  updatedAt: string;
};

export type TradeRow = {
  price: number;
  qty: number;
  ts: number;
  side: "buy" | "sell";
};

export type MexcWsEnvelope<T> = {
  type: string;
  data: T;
};

export type OrderBookRow = DepthLevel & {
  cumQty: number;
  cumNotional: number;
};

// ── Constants ───────────────────────────────────────────

export const PAPER_REFRESH_MS = 30_000;
export const WORKER_HTTP_URL = process.env.NEXT_PUBLIC_MEXC_WORKER_HTTP ?? "http://127.0.0.1:7020";
export const WORKER_WS_URL = process.env.NEXT_PUBLIC_MEXC_WORKER_WS ?? "ws://127.0.0.1:7020/ws";
export const SYMBOL = "ZEPHUSDT";
export const DEPTH_STREAM_LIMIT = 50;
export const TRADES_LIMIT = 50;

// ── Helper functions ────────────────────────────────────

export function buildMexcHttpUrl(path: string): string {
  const base = WORKER_HTTP_URL.endsWith("/") ? WORKER_HTTP_URL.slice(0, -1) : WORKER_HTTP_URL;
  return `${base}${path}`;
}

export function buildMexcWsUrl(topic: string): string {
  const base = WORKER_WS_URL.endsWith("/") ? WORKER_WS_URL.slice(0, -1) : WORKER_WS_URL;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}topic=${encodeURIComponent(topic)}`;
}

export function formatTradeTime(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function maxNotional(levels: DepthLevel[]): number {
  return levels.reduce((max, level) => (level.notional > max ? level.notional : max), 0);
}

export function buildDepthLevel(price: number, qty: number): DepthLevel {
  return {
    price,
    qty,
    notional: price * qty,
  };
}

export function mergeDepthLevels(
  current: DepthLevel[],
  updates: DepthLevel[],
  side: "bid" | "ask",
  limit: number,
): DepthLevel[] {
  const levels = new Map<number, number>();
  current.forEach((level) => {
    if (Number.isFinite(level.price) && Number.isFinite(level.qty)) {
      levels.set(level.price, level.qty);
    }
  });

  updates.forEach((update) => {
    if (!Number.isFinite(update.price) || !Number.isFinite(update.qty)) return;
    if (update.qty <= 0) {
      levels.delete(update.price);
    } else {
      levels.set(update.price, update.qty);
    }
  });

  const sorted = Array.from(levels.entries())
    .map(([price, qty]) => buildDepthLevel(price, qty))
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));

  return sorted.slice(0, limit);
}

export async function parseMexcWsMessage(event: MessageEvent): Promise<MexcWsEnvelope<unknown> | null> {
  let raw: string | null = null;
  if (typeof event.data === "string") {
    raw = event.data;
  } else if (event.data instanceof Blob) {
    raw = await event.data.text();
  } else if (event.data instanceof ArrayBuffer) {
    raw = new TextDecoder().decode(event.data);
  }

  if (!raw) return null;

  try {
    return JSON.parse(raw) as MexcWsEnvelope<unknown>;
  } catch {
    return null;
  }
}

export function toDepthLevels(levels: Array<{ price: number; qty: number }>): DepthLevel[] {
  return levels
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.qty))
    .map((level) => buildDepthLevel(level.price, level.qty));
}

export function normalizeDepthLevels(levels: DepthLevel[], side: "bid" | "ask", limit: number): DepthLevel[] {
  return levels
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.qty))
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price))
    .slice(0, limit);
}

export function applyTickerSummary(base: MarketSummary, ticker: MexcTickerSnapshot): MarketSummary {
  const bid = Number(ticker.bid);
  const ask = Number(ticker.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return base;

  const spread = ask - bid;
  const mid = (ask + bid) / 2;
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;
  const generatedAt = new Date(ticker.ts || Date.now()).toISOString();

  return {
    ...base,
    symbol: ticker.symbol ?? base.symbol,
    bestBid: bid,
    bestAsk: ask,
    spread,
    spreadBps,
    mid,
    generatedAt,
  };
}

export function applyDepthSummary(
  base: MarketSummary,
  bids: DepthLevel[],
  asks: DepthLevel[],
  ts: number,
  replace: boolean,
): MarketSummary {
  const nextBids = replace
    ? normalizeDepthLevels(bids, "bid", DEPTH_STREAM_LIMIT)
    : mergeDepthLevels(base.bids ?? [], bids, "bid", DEPTH_STREAM_LIMIT);
  const nextAsks = replace
    ? normalizeDepthLevels(asks, "ask", DEPTH_STREAM_LIMIT)
    : mergeDepthLevels(base.asks ?? [], asks, "ask", DEPTH_STREAM_LIMIT);

  const bidUsd = nextBids.reduce((acc, level) => acc + level.notional, 0);
  const askUsd = nextAsks.reduce((acc, level) => acc + level.notional, 0);
  const generatedAt = new Date(ts || Date.now()).toISOString();

  return {
    ...base,
    bids: nextBids,
    asks: nextAsks,
    depthUsd: { bidUsd, askUsd },
    generatedAt,
  };
}

export function mapMexcTrade(trade: MexcTradeSnapshot): TradeRow {
  return {
    price: trade.price,
    qty: trade.qty,
    ts: trade.ts,
    side: trade.side ?? "buy",
  };
}

export function buildOrderBookRows(levels: DepthLevel[], _side: "bid" | "ask", limit: number): OrderBookRow[] {
  let cumQty = 0;
  let cumNotional = 0;
  return levels
    .slice(0, limit)
    .map((level) => {
      cumQty += level.qty;
      cumNotional += level.notional;
      return {
        ...level,
        cumQty,
        cumNotional,
      };
    })
    .map((row) => row);
}

export function createEmptyMarket(): MarketSummary {
  return {
    symbol: SYMBOL,
    bestBid: 0,
    bestAsk: 0,
    spread: 0,
    spreadBps: 0,
    mid: 0,
    bids: [],
    asks: [],
    depthUsd: { bidUsd: 0, askUsd: 0 },
    generatedAt: "",
  };
}
