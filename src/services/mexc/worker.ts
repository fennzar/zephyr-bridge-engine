import fetch from "cross-fetch";

import { env } from "@shared";

export type MexcWorkerTicker = {
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
};

export type MexcWorkerDepthLevel = {
  price: number;
  qty: number;
};

export type MexcWorkerDepth = {
  symbol: string;
  bids: MexcWorkerDepthLevel[];
  asks: MexcWorkerDepthLevel[];
  ts: number;
};

export type MexcWorkerTrade = {
  symbol: string;
  price: number;
  qty: number;
  ts: number;
  side?: "buy" | "sell";
};

export type MexcWorkerWatcherSnapshot = {
  live: boolean;
  lastUpdatedAt?: number | null;
};

export type MexcWorkerSnapshot = {
  ticker?: MexcWorkerTicker;
  depth?: MexcWorkerDepth;
  trades: MexcWorkerTrade[];
  lastUpdatedAt?: number | null;
  staleAfterMs?: number;
  watcher: MexcWorkerWatcherSnapshot;
};

export type MexcWorkerTradesResponse = {
  trades: MexcWorkerTrade[];
  lastUpdatedAt?: number | null;
};

const DEFAULT_WORKER_BASE_URL =
  process.env.MEXC_WATCHER_HTTP ?? `http://127.0.0.1:${env.MEXC_WATCHER_PORT}`;

function resolveBaseUrl(baseUrl?: string): string {
  if (!baseUrl || baseUrl.trim().length === 0) {
    return DEFAULT_WORKER_BASE_URL;
  }
  return baseUrl.replace(/\/+$/, "");
}

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    return json;
  } catch {
    return null;
  }
}

export async function fetchMexcWorkerSnapshot(options: {
  limit?: number;
  baseUrl?: string;
} = {}): Promise<MexcWorkerSnapshot | null> {
  const { limit, baseUrl } = options;
  const resolvedBase = resolveBaseUrl(baseUrl);
  const url = new URL("/snapshot", resolvedBase);
  if (limit && Number.isFinite(limit) && limit > 0) {
    url.searchParams.set("limit", String(limit));
  }
  return safeFetch<MexcWorkerSnapshot>(url.toString());
}

export async function fetchMexcWorkerTrades(options: {
  limit?: number;
  baseUrl?: string;
} = {}): Promise<MexcWorkerTradesResponse | null> {
  const { limit, baseUrl } = options;
  const resolvedBase = resolveBaseUrl(baseUrl);
  const url = new URL("/trades", resolvedBase);
  if (limit && Number.isFinite(limit) && limit > 0) {
    url.searchParams.set("limit", String(limit));
  }
  return safeFetch<MexcWorkerTradesResponse>(url.toString());
}
