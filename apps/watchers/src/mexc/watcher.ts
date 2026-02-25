import { Watcher } from "@domain";
import { mexc } from "@services";
import { createLogger } from "@shared/logger";

import {
  addTrade,
  markWatcherDisconnected,
  markWatcherLive,
  updateDepth,
  updateTicker,
  startDbPersistence,
  stopDbPersistence,
  flushToDbNow,
} from "./snapshot";

export type StartMexcTickerWatcherOptions = {
  symbols: string[];
  onEvent?: (event: mexc.MexcWsEvent) => void;
  depth?: boolean;
  depthLevels?: number;
};

export type MexcTickerWatcherHandle = {
  watcher: Watcher;
  ws: mexc.MexcWs;
  shutdown: () => Promise<void>;
};

const log = createLogger("MEXC:Watcher");

export function startMexcTickerWatcher(
  options: StartMexcTickerWatcherOptions,
): MexcTickerWatcherHandle {
  const symbols = options.symbols;
  if (symbols.length === 0) {
    throw new Error("At least one symbol must be provided");
  }

  const watcher = new Watcher();
  const mexcWs = new mexc.MexcWs();

  const handleError = (error: mexc.MexcWsError) => {
    const code = error.code ? ` (code ${error.code})` : "";
    log.error(`websocket ${error.type} error${code}: ${error.message}`);
    if (error.details) {
      log.error("websocket error details:", error.details);
    }
    markWatcherDisconnected();
  };

  mexcWs.on("error", handleError);

  const handleEvent = (event: mexc.MexcWsEvent) => {
    markWatcherLive();

    if (event.type === "bookTicker" && event.symbol && event.bid && event.ask) {
      const ticker = {
        symbol: event.symbol,
        bid: event.bid,
        ask: event.ask,
        ts: event.ts,
        venue: "MEXC" as const,
      };
      updateTicker(ticker);
      watcher.emitTicker(ticker);
    }

    if (event.type === "depth") {
      const depth = {
        symbol: event.symbol,
        bids: event.bids,
        asks: event.asks,
        ts: event.ts,
        venue: "MEXC" as const,
      };
      updateDepth(depth);
      watcher.emitDepth(depth);
    }

    if (event.type === "aggTrade") {
      addTrade(event);
      watcher.emitTrade({
        symbol: event.symbol,
        price: event.price,
        qty: event.qty,
        ts: event.ts,
        venue: "MEXC",
        side: event.side,
      });
    }
    options.onEvent?.(event);
  };

  mexcWs.on("event", handleEvent);
  mexcWs.connect(symbols, {
    depth: options.depth ?? true,
    depthLevels: options.depthLevels ?? 50,
    aggTrades: true,
  });

  let pollTimer: NodeJS.Timeout | undefined;

  const pollSnapshot = async () => {
    try {
      for (const symbol of symbols) {
        const summary = await mexc.summarizeDepth(symbol, options.depthLevels ?? 50);
        const ts = Date.now();
        if (summary.bids.length || summary.asks.length) {
          const depthFrame = {
            symbol: summary.symbol,
            bids: summary.bids.map((level) => ({ price: level.price, qty: level.qty })),
            asks: summary.asks.map((level) => ({ price: level.price, qty: level.qty })),
            ts,
            venue: "MEXC" as const,
          };
          updateDepth(depthFrame);
          watcher.emitDepth(depthFrame);
        }
        if (summary.bestBid || summary.bestAsk) {
          const tickerFrame = {
            symbol: summary.symbol,
            bid: summary.bestBid,
            ask: summary.bestAsk,
            ts,
            venue: "MEXC" as const,
          };
          updateTicker(tickerFrame);
          watcher.emitTicker(tickerFrame);
        }
        markWatcherLive();
      }
    } catch (error) {
      log.warn("depth poll failed", error instanceof Error ? error.message : error);
    }
  };

  const pollIntervalMs = Number(process.env.MEXC_POLL_INTERVAL_MS ?? 15_000);
  pollTimer = setInterval(() => {
    void pollSnapshot();
  }, pollIntervalMs);

  const bootstrap = async () => {
    try {
      await pollSnapshot();
    } catch (error) {
      log.warn("failed to bootstrap snapshot", error);
    }
  };

  void bootstrap();

  // Start DB persistence
  startDbPersistence();

  const shutdown = async () => {
    // Flush to DB before shutdown
    await flushToDbNow();
    stopDbPersistence();
    
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    mexcWs.off("error", handleError);
    mexcWs.off("event", handleEvent);
    mexcWs.close?.();
    markWatcherDisconnected();
  };

  return { watcher, ws: mexcWs, shutdown };
}
