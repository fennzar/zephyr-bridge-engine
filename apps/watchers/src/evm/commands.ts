import { Command } from "commander";
import { env } from "@shared";
import { createLogger } from "@shared/logger";
import {
  normalizeNetwork,
  parseOptionalBigInt,
  resolveDefaultStartBlock,
} from "../shared/networks";
import { startUniswapPoolWatcher } from "./watcher";
import { performPoolAction } from "@services/evm/poolMaintenance";

const log = createLogger("EVM");

type WatchPoolsOptions = {
  network?: string;
  fromBlock?: string;
};

type ActionOptions = {
  network?: string;
  fromBlock?: string;
};

export function registerEvmCommands(program: Command): void {
  program
    .command("watch-pools")
    .description("Sync and follow Uniswap v4 pools via websockets")
    .option("--network <env>", "Network to target (local|sepolia|mainnet)")
    .option("--from-block <block>", "Override starting block number")
    .action(async (opts: WatchPoolsOptions) => {
      const network = normalizeNetwork(opts.network) ?? env.ZEPHYR_ENV;
      const fromBlock = parseOptionalBigInt(opts.fromBlock);
      const startBlock = fromBlock ?? resolveDefaultStartBlock(network);

      const handle = await startUniswapPoolWatcher({
        network,
        startBlock,
      });

      if (startBlock !== undefined) {
        log.info(
          `Watching Uniswap v4 pools on ${network} from block ${startBlock.toString()}. Press Ctrl+C to exit.`,
        );
      } else {
        log.info(
          `Watching Uniswap v4 pools on ${network}. Press Ctrl+C to exit.`,
        );
      }

      const shutdown = async () => {
        log.info("\nStopping Uniswap v4 watcher...");
        await handle.shutdown();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await new Promise(() => {});
    });

  program
    .command("refresh")
    .description("Run a single refresh cycle for tracked pools")
    .option("--network <env>", "Network to target (local|sepolia|mainnet)")
    .action(async (opts: ActionOptions) => {
      const network = normalizeNetwork(opts.network) ?? env.ZEPHYR_ENV;
      const result = await performPoolAction("refresh", { network });
      log.info(result.message);
    });

  program
    .command("backfill")
    .description("Run historical backfill for tracked pools")
    .option("--network <env>", "Network to target (local|sepolia|mainnet)")
    .option("--from-block <block>", "Override starting block number")
    .action(async (opts: ActionOptions) => {
      const network = normalizeNetwork(opts.network) ?? env.ZEPHYR_ENV;
      const fromBlock = parseOptionalBigInt(opts.fromBlock);
      const result = await performPoolAction("backfill", {
        network,
        fromBlock,
      });
      log.info(result.message);
    });

  program
    .command("reset")
    .description(
      "Reset the pool watcher cursor so the next run re-scans from the start block",
    )
    .option("--network <env>", "Network to target (local|sepolia|mainnet)")
    .action(async (opts: ActionOptions) => {
      const network = normalizeNetwork(opts.network) ?? env.ZEPHYR_ENV;
      const result = await performPoolAction("reset", { network });
      log.info(result.message);
    });
}
