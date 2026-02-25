import type { BookDepth, BookTicker, BookTrade } from "@domain";
import type { MexcWsAggTradeEvent } from "@services/mexc/ws";
import { prisma, Prisma } from "@infra";
import { createLogger } from "@shared/logger";

const log = createLogger("MEXC:Snapshot");

const MAX_TRADES = 200;
const DEFAULT_STALE_AFTER_MS = Number(process.env.MEXC_WATCHER_STALE_AFTER_MS ?? 30_000);
const DB_FLUSH_INTERVAL_MS = Number(process.env.MEXC_DB_FLUSH_INTERVAL_MS ?? 60_000); // 1 minute

type SnapshotState = {
  ticker?: BookTicker;
  depth?: BookDepth;
  trades: BookTrade[];
  lastUpdatedAt?: number;
  staleAfterMs: number;
  watcher: {
    live: boolean;
    lastUpdatedAt?: number;
  };
};

const state: SnapshotState = {
  trades: [],
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
  watcher: {
    live: false,
    lastUpdatedAt: undefined,
  },
};

export function markWatcherLive(): void {
  state.watcher.live = true;
  state.watcher.lastUpdatedAt = Date.now();
}

export function markWatcherDisconnected(): void {
  state.watcher.live = false;
}

export function updateTicker(ticker: BookTicker): void {
  state.ticker = ticker;
  state.lastUpdatedAt = ticker.ts;
  state.watcher.live = true;
  state.watcher.lastUpdatedAt = ticker.ts;
}

export function updateDepth(depth: BookDepth): void {
  state.depth = depth;
  state.lastUpdatedAt = depth.ts;
  state.watcher.live = true;
  state.watcher.lastUpdatedAt = depth.ts;
}

export function addTrade(event: MexcWsAggTradeEvent): void {
  const trade: BookTrade = {
    symbol: event.symbol,
    price: event.price,
    qty: event.qty,
    ts: event.ts,
    venue: "MEXC",
    side: event.side,
  };
  state.trades.unshift(trade);
  if (state.trades.length > MAX_TRADES) {
    state.trades.length = MAX_TRADES;
  }
  state.lastUpdatedAt = event.ts;
  state.watcher.live = true;
  state.watcher.lastUpdatedAt = event.ts;
}

export function getHealthSnapshot() {
  const now = Date.now();
  const last = state.lastUpdatedAt ?? state.watcher.lastUpdatedAt ?? 0;
  const stale = last === 0 ? true : now - last > state.staleAfterMs;
  return {
    live: state.watcher.live,
    stale,
    lastUpdatedAt: last || null,
    staleAfterMs: state.staleAfterMs,
  };
}

export function getMexcSnapshot() {
  return {
    ticker: state.ticker,
    depth: state.depth,
    trades: state.trades.slice(0, 50),
    lastUpdatedAt: state.lastUpdatedAt ?? null,
    staleAfterMs: state.staleAfterMs,
    watcher: {
      ...state.watcher,
    },
  };
}

// ===========================================================================
// Database Persistence
// ===========================================================================

let lastDbFlush = 0;
let flushPending = false;

/**
 * Persist current market snapshot to database.
 * Called periodically (every DB_FLUSH_INTERVAL_MS) or on significant changes.
 */
async function persistToDb(): Promise<void> {
  if (flushPending) return;
  
  const now = Date.now();
  if (now - lastDbFlush < DB_FLUSH_INTERVAL_MS) return;
  
  const ticker = state.ticker;
  const depth = state.depth;
  
  if (!ticker?.symbol || ticker.bid == null || ticker.ask == null) return;
  
  flushPending = true;
  
  try {
    // Prepare depth data for JSON storage
    const depthJson = depth
      ? {
          bids: depth.bids.slice(0, 20).map((l) => [l.price, l.qty]),
          asks: depth.asks.slice(0, 20).map((l) => [l.price, l.qty]),
        }
      : undefined;
    
    // Get bid/ask quantities from depth if available
    const bidQty = depth?.bids?.[0]?.qty;
    const askQty = depth?.asks?.[0]?.qty;

    await prisma.marketSnapshot.create({
      data: {
        symbol: ticker.symbol,
        bid: ticker.bid,
        ask: ticker.ask,
        bidQty,
        askQty,
        depth: depthJson ?? Prisma.JsonNull,
        capturedAt: new Date(ticker.ts ?? now),
      },
    });

    lastDbFlush = now;
  } catch (error) {
    log.error("Failed to persist market snapshot:", error);
  } finally {
    flushPending = false;
  }
}

/**
 * Start the periodic DB flush timer.
 * Should be called when the watcher starts.
 */
let dbFlushTimer: NodeJS.Timeout | undefined;

export function startDbPersistence(): void {
  if (dbFlushTimer) return;
  
  dbFlushTimer = setInterval(() => {
    void persistToDb();
  }, DB_FLUSH_INTERVAL_MS);
  
  log.info(`DB persistence started (interval: ${DB_FLUSH_INTERVAL_MS}ms)`);
}

export function stopDbPersistence(): void {
  if (dbFlushTimer) {
    clearInterval(dbFlushTimer);
    dbFlushTimer = undefined;
    log.info("DB persistence stopped");
  }
}

/**
 * Force an immediate DB flush (e.g., on shutdown or significant event).
 */
export async function flushToDbNow(): Promise<void> {
  flushPending = false; // Reset pending flag to force write
  lastDbFlush = 0; // Reset timer to force write
  await persistToDb();
}
