import { Command } from "commander";
import { env } from "@shared";
import { createLogger } from "@shared/logger";
import { mexc } from "@services";
import { parseSymbols } from "../shared/symbols";
import { startMexcTickerWatcher } from "./watcher";
import { startMexcHttpServer } from "./http";
import { startMexcWebsocketServer } from "./wsServer";

const log = createLogger("MEXC");

export const DEFAULT_SYMBOLS = ["ZEPHUSDT"];

type WatchOptions = {
  symbols?: string;
  port?: string;
  host?: string;
};

export function registerMexcCommands(program: Command): void {
  program
    .command("watch")
    .description("Stream book tickers from MEXC websockets")
    .option(
      "-s, --symbols <symbols>",
      "Comma separated list of symbols",
      DEFAULT_SYMBOLS.join(","),
    )
    .option("--port <port>", "HTTP/WS port for the watcher", process.env.MEXC_WATCHER_PORT)
    .option("--host <host>", "Bind host for the watcher", process.env.MEXC_WATCHER_HOST)
    .action(async (opts: WatchOptions) => {
      const symbols = parseSymbols(opts.symbols, DEFAULT_SYMBOLS);
      if (symbols.length === 0) {
        throw new Error("At least one symbol must be provided");
      }

      const watcherHandle = startMexcTickerWatcher({
        symbols,
        depth: true,
        depthLevels: 50,
        onEvent(event: mexc.MexcWsEvent) {
          if (event.type === "bookTicker") {
            log.info(`${event.symbol} b:${event.bid} a:${event.ask}`);
          }
        },
      });

      const requestedPort = opts.port ? Number(opts.port) : undefined;
      const httpHandle = startMexcHttpServer({
        port: Number.isFinite(requestedPort) ? requestedPort : undefined,
        host: opts.host,
      });

      const wsHandle = startMexcWebsocketServer({
        server: httpHandle.server,
        watcher: watcherHandle.watcher,
      });

      log.info("Watching MEXC tickers:", symbols.join(","));
      log.info(`HTTP snapshot available at http://${httpHandle.host}:${httpHandle.port}/snapshot`);
      log.info(`WebSocket stream available at ws://${httpHandle.host}:${httpHandle.port}/ws?topic=ticker|depth|trades`);
      log.info("Press Ctrl+C to exit");

      const shutdown = async () => {
        log.info("\nStopping MEXC watcher...");
        await wsHandle.shutdown();
        await httpHandle.shutdown();
        await watcherHandle.shutdown();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await new Promise(() => {});
    });

  program
    .command("ping")
    .description("Ping the MEXC REST API")
    .action(async () => {
      if (!env.MEXC_API_KEY || !env.MEXC_API_SECRET) {
        log.error("Missing MEXC keys (MEXC_API_KEY / MEXC_API_SECRET)");
        process.exit(1);
      }

      const rest = new mexc.MexcRest({
        apiKey: env.MEXC_API_KEY,
        apiSecret: env.MEXC_API_SECRET,
      });

      log.info("Time:", await rest.time());
      log.info("Ping:", await rest.ping());
    });
}
