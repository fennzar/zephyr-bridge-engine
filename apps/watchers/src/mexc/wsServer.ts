import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { URL } from "node:url";

import type { Watcher } from "@domain";

import { getMexcSnapshot } from "./snapshot";

export type MexcWebsocketOptions = {
  server: Server;
  watcher: Watcher;
  path?: string;
};

export type MexcWebsocketHandle = {
  shutdown: () => Promise<void>;
};

type Topic = "ticker" | "depth" | "trades";

type ClientRecord = {
  socket: WebSocket;
  topic: Topic;
};

const TOPIC_PARAM = "topic";

export function startMexcWebsocketServer(options: MexcWebsocketOptions): MexcWebsocketHandle {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientRecord>();
  const path = options.path ?? "/ws";

  const sendInitial = (ws: WebSocket, topic: Topic) => {
    const snapshot = getMexcSnapshot();
    if (topic === "ticker" && snapshot.ticker) {
      ws.send(JSON.stringify({ type: "ticker", data: snapshot.ticker }));
    } else if (topic === "depth" && snapshot.depth) {
      ws.send(JSON.stringify({ type: "depth", data: snapshot.depth }));
    } else if (topic === "trades" && snapshot.trades.length > 0) {
      ws.send(JSON.stringify({ type: "trades", data: snapshot.trades.slice(0, 50) }));
    }
  };

  const broadcast = (topic: Topic, payload: unknown) => {
    const data = JSON.stringify({ type: topic, data: payload });
    for (const client of clients) {
      if (client.topic !== topic) continue;
      if (client.socket.readyState === client.socket.OPEN) {
        try {
          client.socket.send(data);
        } catch {
          // ignore
        }
      }
    }
  };

  const onTicker = (ticker: Parameters<Watcher["emitTicker"]>[0]) => {
    broadcast("ticker", ticker);
  };
  const onDepth = (depth: Parameters<Watcher["emitDepth"]>[0]) => {
    broadcast("depth", depth);
  };
  const onTrade = (trade: Parameters<Watcher["emitTrade"]>[0]) => {
    broadcast("trades", trade);
  };

  options.watcher.on("ticker", onTicker);
  options.watcher.on("depth", onDepth);
  options.watcher.on("trade", onTrade);

  const upgradeHandler = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    try {
      const { url } = request;
      if (!url) {
        socket.destroy();
        return;
      }
      const parsed = new URL(url, "http://localhost");
      if (parsed.pathname !== path) {
        socket.destroy();
        return;
      }
      const topic = (parsed.searchParams.get(TOPIC_PARAM) as Topic | null) ?? "ticker";
      if (!isValidTopic(topic)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const record: ClientRecord = { socket: ws, topic };
        clients.add(record);
        ws.on("close", () => {
          clients.delete(record);
        });
        sendInitial(ws, topic);
      });
    } catch {
      socket.destroy();
    }
  };

  options.server.on("upgrade", upgradeHandler);

  const shutdown = async () => {
    options.watcher.off("ticker", onTicker);
    options.watcher.off("depth", onDepth);
    options.watcher.off("trade", onTrade);
    options.server.off("upgrade", upgradeHandler);

    for (const client of clients) {
      try {
        client.socket.close();
      } catch {
        // ignore
      }
    }
    clients.clear();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };

  return { shutdown };
}

function isValidTopic(topic: string): topic is Topic {
  return topic === "ticker" || topic === "depth" || topic === "trades";
}
