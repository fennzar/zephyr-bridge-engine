import http from "node:http";
import { URL } from "node:url";

import { env } from "@shared";

import { getHealthSnapshot, getMexcSnapshot } from "./snapshot";

export type MexcHttpServerOptions = {
  port?: number;
  host?: string;
};

export type MexcHttpServerHandle = {
  port: number;
  host: string;
  server: http.Server;
  shutdown: () => Promise<void>;
};

export function startMexcHttpServer(options: MexcHttpServerOptions = {}): MexcHttpServerHandle {
  const port = options.port ?? env.MEXC_WATCHER_PORT ?? 7020;
  const host = options.host ?? process.env.MEXC_WATCHER_HOST ?? "127.0.0.1";

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${host}:${port}`);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const corsOrigin = process.env.MEXC_WATCHER_CORS_ORIGIN ?? "*";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      const health = getHealthSnapshot();
      res.statusCode = 200;
      res.end(JSON.stringify(health));
      return;
    }

    if (url.pathname === "/snapshot") {
      const snapshot = getMexcSnapshot();
      if (url.searchParams.has("limit")) {
        const limit = Number(url.searchParams.get("limit"));
        if (Number.isFinite(limit) && limit > 0) {
          snapshot.trades = snapshot.trades.slice(0, limit);
          if (snapshot.depth) {
            snapshot.depth = {
              ...snapshot.depth,
              bids: snapshot.depth.bids.slice(0, limit),
              asks: snapshot.depth.asks.slice(0, limit),
            };
          }
        }
      }
      res.statusCode = 200;
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (url.pathname === "/trades") {
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw))) : 50;
      const snapshot = getMexcSnapshot();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          trades: snapshot.trades.slice(0, limit),
          lastUpdatedAt: snapshot.lastUpdatedAt,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, host);

  const shutdown = async () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  return { port, host, server, shutdown };
}
