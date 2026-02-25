import fetch from 'cross-fetch';

export type MexcDepthLevel = {
  price: number;
  qty: number;
  notional: number;
};

export type MexcDepthResponse = {
  lastUpdateId: number;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
};

export type MexcDepthSummary = {
  symbol: string;
  lastUpdateId: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  mid: number;
  bids: MexcDepthLevel[];
  asks: MexcDepthLevel[];
  depthUsd: {
    bidUsd: number;
    askUsd: number;
  };
  generatedAt: string;
};

const FAKE_ORDERBOOK_ENABLED = process.env.FAKE_ORDERBOOK_ENABLED === 'true';
const FAKE_ORDERBOOK_PORT = process.env.FAKE_ORDERBOOK_PORT || '5556';
const DEFAULT_BASE_URL = FAKE_ORDERBOOK_ENABLED
  ? `http://127.0.0.1:${FAKE_ORDERBOOK_PORT}`
  : 'https://api.mexc.com';

function normaliseLevels(levels: Array<[string, string]>): MexcDepthLevel[] {
  return levels.map(([priceRaw, qtyRaw]) => {
    const price = Number(priceRaw);
    const qty = Number(qtyRaw);
    return {
      price,
      qty,
      notional: price * qty,
    };
  });
}

function computeUsdDepth(levels: MexcDepthLevel[]): number {
  return levels.reduce((acc, level) => acc + level.notional, 0);
}

export async function fetchDepth(symbol: string, limit = 20, baseUrl = DEFAULT_BASE_URL): Promise<MexcDepthResponse> {
  const url = new URL('/api/v3/depth', baseUrl);
  url.searchParams.set('symbol', symbol.toUpperCase());
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MEXC depth error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as MexcDepthResponse;
  return json;
}

export async function summarizeDepth(symbol: string, limit = 20, baseUrl = DEFAULT_BASE_URL): Promise<MexcDepthSummary> {
  const depth = await fetchDepth(symbol, limit, baseUrl);
  const bids = normaliseLevels(depth.bids);
  const asks = normaliseLevels(depth.asks);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;
  return {
    symbol: symbol.toUpperCase(),
    lastUpdateId: depth.lastUpdateId,
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    mid,
    bids,
    asks,
    depthUsd: {
      bidUsd: computeUsdDepth(bids),
      askUsd: computeUsdDepth(asks),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getMexcDepth(symbol: string, limit = 20, baseUrl = DEFAULT_BASE_URL): Promise<MexcDepthSummary> {
  const normalised = symbol.replace(/[_\s]/g, "").toUpperCase();
  return summarizeDepth(normalised, limit, baseUrl);
}
