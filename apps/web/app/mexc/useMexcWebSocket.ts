"use client";

import { useEffect, useState } from "react";
import type { MarketSummary, MexcTickerSnapshot, MexcDepthSnapshot, MexcTradeSnapshot, MexcSnapshot } from "@/types/api";
import {
  buildMexcHttpUrl,
  buildMexcWsUrl,
  parseMexcWsMessage,
  toDepthLevels,
  applyTickerSummary,
  applyDepthSummary,
  mapMexcTrade,
  createEmptyMarket,
  DEPTH_STREAM_LIMIT,
  TRADES_LIMIT,
  type TradeRow,
} from "./mexc.helpers";

export type WsStatus = "connecting" | "live" | "error";

export function useMexcWebSocket(
  setMarket: React.Dispatch<React.SetStateAction<MarketSummary>>,
  setTrades: React.Dispatch<React.SetStateAction<TradeRow[]>>,
): { wsStatus: WsStatus; wsError: string | null } {
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [wsError, setWsError] = useState<string | null>(null);

  // Initial snapshot + recent trades fetch
  useEffect(() => {
    let cancelled = false;

    const loadRecentTrades = async () => {
      try {
        const res = await fetch(buildMexcHttpUrl(`/trades?limit=${TRADES_LIMIT}`), { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { trades: MexcTradeSnapshot[] };
        if (cancelled || !Array.isArray(body.trades)) return;
        setTrades(body.trades.slice(0, TRADES_LIMIT).map(mapMexcTrade));
      } catch {
        // ignore bootstrap trade failures; websocket will update shortly
      }
    };

    const loadSnapshot = async () => {
      try {
        const res = await fetch(buildMexcHttpUrl(`/snapshot?limit=${DEPTH_STREAM_LIMIT}`), {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Snapshot fetch failed (${res.status})`);
        }
        const snapshot = (await res.json()) as MexcSnapshot;
        if (cancelled) return;

        setMarket((prev) => {
          let next = prev ?? createEmptyMarket();
          if (snapshot.ticker) {
            next = applyTickerSummary(next, snapshot.ticker);
          }
          if (snapshot.depth) {
            const bids = toDepthLevels(snapshot.depth.bids);
            const asks = toDepthLevels(snapshot.depth.asks);
            next = applyDepthSummary(next, bids, asks, snapshot.depth.ts, true);
          }
          return next;
        });

        if (snapshot.trades?.length) {
          const mapped = snapshot.trades.slice(0, TRADES_LIMIT).map(mapMexcTrade);
          setTrades(mapped);
        } else {
          await loadRecentTrades();
        }
      } catch (error) {
        setWsError(error instanceof Error ? error.message : "Failed to load snapshot");
        void loadRecentTrades();
      }
    };

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [setMarket, setTrades]);

  // Ticker WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setWsStatus("connecting");
      const socket = new WebSocket(buildMexcWsUrl("ticker"));
      ws = socket;

      const handleMessage = (event: MessageEvent) => {
        void (async () => {
          const envelope = await parseMexcWsMessage(event);
          if (!envelope || envelope.type !== "ticker") return;
          const ticker = envelope.data as MexcTickerSnapshot;
          setMarket((prev) => applyTickerSummary(prev ?? createEmptyMarket(), ticker));
        })();
      };

      const scheduleReconnect = () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1_000);
      };

      socket.addEventListener("open", () => {
        setWsStatus("live");
        setWsError(null);
      });
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", () => {
        setWsStatus("connecting");
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        setWsStatus("error");
        setWsError("Ticker stream error \u2013 reconnecting");
        socket.close();
      });
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [setMarket]);

  // Depth WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const socket = new WebSocket(buildMexcWsUrl("depth"));
      ws = socket;

      const handleMessage = (event: MessageEvent) => {
        void (async () => {
          const envelope = await parseMexcWsMessage(event);
          if (!envelope || envelope.type !== "depth") return;
          const depth = envelope.data as MexcDepthSnapshot;
          const bids = toDepthLevels(depth.bids);
          const asks = toDepthLevels(depth.asks);
          setMarket((prev) => applyDepthSummary(prev ?? createEmptyMarket(), bids, asks, depth.ts, false));
        })();
      };

      const scheduleReconnect = () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1_000);
      };

      socket.addEventListener("open", () => {
        setWsError(null);
      });
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", () => {
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        setWsError("Depth stream error \u2013 reconnecting");
        socket.close();
      });
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [setMarket]);

  // Trades WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const socket = new WebSocket(buildMexcWsUrl("trades"));
      ws = socket;

      const handleMessage = (event: MessageEvent) => {
        void (async () => {
          const envelope = await parseMexcWsMessage(event);
          if (!envelope || envelope.type !== "trades") return;
          const payload = envelope.data;
          if (Array.isArray(payload)) {
            const mapped = (payload as MexcTradeSnapshot[])
              .slice(0, TRADES_LIMIT)
              .map(mapMexcTrade);
            setTrades(mapped);
          } else {
            const trade = mapMexcTrade(payload as MexcTradeSnapshot);
            setTrades((prev) => [trade, ...prev].slice(0, TRADES_LIMIT));
          }
        })();
      };

      const scheduleReconnect = () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1_000);
      };

      socket.addEventListener("message", handleMessage);
      socket.addEventListener("open", () => {
        setWsError(null);
      });
      socket.addEventListener("close", () => {
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        setWsError("Trades stream error \u2013 reconnecting");
        socket.close();
      });
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [setTrades]);

  return { wsStatus, wsError };
}
