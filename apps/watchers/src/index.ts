#!/usr/bin/env node
import { Command } from "commander";
import { env } from "@shared";
import { createLogger } from "@shared/logger";
import { mexc } from "@services";
import { registerMexcCommands, DEFAULT_SYMBOLS } from "./mexc/commands";
import { registerEvmCommands } from "./evm/commands";
import { parseSymbols } from "./shared/symbols";
import {
  normalizeNetwork,
  parseOptionalBigInt,
  resolveDefaultStartBlock,
} from "./shared/networks";
import { startMexcTickerWatcher } from "./mexc/watcher";
import { startMexcHttpServer } from "./mexc/http";
import { startMexcWebsocketServer } from "./mexc/wsServer";
import { startUniswapPoolWatcher } from "./evm/watcher";

const log = createLogger("Watchers");

const program = new Command();
program
  .name("zephyr-watchers")
  .description("Data-feed watcher orchestrator")
  .version("0.1.0");

registerMexcCommands(program);
registerEvmCommands(program);

program
  .command("ping-cex")
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

program
  .command("run")
  .description(
    "Start both MEXC ticker watcher and Uniswap v4 pool watcher concurrently",
  )
  .option(
    "-s, --symbols <symbols>",
    "MEXC symbols (comma separated)",
    DEFAULT_SYMBOLS.join(","),
  )
  .option("--network <env>", "Network to target (local|sepolia|mainnet)")
  .option("--from-block <block>", "Override starting block number")
  .action(async (opts) => {
    const symbols = parseSymbols(opts.symbols, DEFAULT_SYMBOLS);
    if (symbols.length === 0) {
      throw new Error("At least one symbol must be provided");
    }

    const network = normalizeNetwork(opts.network) ?? env.ZEPHYR_ENV;
    const rawFromBlock =
      (opts as Record<string, string | undefined>).fromBlock ??
      (opts as Record<string, string | undefined>).from_block;
    const fromBlock = parseOptionalBigInt(rawFromBlock);
    const startBlock = fromBlock ?? resolveDefaultStartBlock(network);

    const mexcHandle = startMexcTickerWatcher({
      symbols,
      depth: true,
      depthLevels: 50,
      onEvent(event) {
        if (event.type === "bookTicker") {
          log.info(`${event.symbol} b:${event.bid} a:${event.ask}`);
        }
      },
    });

    const parsedPort = process.env.MEXC_WATCHER_PORT ? Number(process.env.MEXC_WATCHER_PORT) : undefined;
    const mexcHttp = startMexcHttpServer({
      port: Number.isFinite(parsedPort) ? parsedPort : undefined,
      host: process.env.MEXC_WATCHER_HOST,
    });

    const mexcWs = startMexcWebsocketServer({
      server: mexcHttp.server,
      watcher: mexcHandle.watcher,
    });

    log.info("Watching MEXC tickers:", symbols.join(","));
    log.info(`MEXC snapshot endpoint: http://${mexcHttp.host}:${mexcHttp.port}/snapshot`);
    log.info(`MEXC websocket stream: ws://${mexcHttp.host}:${mexcHttp.port}/ws?topic=ticker|depth|trades`);

    const poolHandle = await startUniswapPoolWatcher({
      network,
      startBlock,
    });

    if (startBlock !== undefined) {
      log.info(
        `Watching Uniswap v4 pools on ${network} from block ${startBlock.toString()}.`,
      );
    } else {
      log.info(`Watching Uniswap v4 pools on ${network}.`);
    }

    log.info("Press Ctrl+C to exit");

    const shutdown = async () => {
      log.info("\nShutting down watchers...");
      await mexcWs.shutdown();
      await mexcHttp.shutdown();
      await mexcHandle.shutdown();
      await poolHandle.shutdown();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await new Promise(() => {});
  });

program.parseAsync();
