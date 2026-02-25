#!/usr/bin/env tsx
/**
 * Zephyr reserve watcher CLI.
 */

import { Command } from "commander";
import "@shared/loadEnv";
import { createLogger } from "@shared/logger";

import { startZephyrWatcher, getZephyrSnapshot } from "./zephyr/watcher";
import { getReserveInfo } from "@services/zephyr/zephyrd";

const log = createLogger("Zephyr");

const program = new Command();

program
  .name("zephyr")
  .description("Zephyr reserve watcher commands")
  .version("0.1.0");

program
  .command("watch")
  .description("Start the Zephyr reserve watcher")
  .option("-i, --interval <ms>", "Poll interval in milliseconds", "10000")
  .action(async (options) => {
    log.info("Starting Zephyr reserve watcher...");

    const handle = startZephyrWatcher({
      pollIntervalMs: Number(options.interval),
    });

    // Keep alive
    process.on("SIGINT", async () => {
      log.info("\nReceived SIGINT, shutting down...");
      await handle.shutdown();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      log.info("\nReceived SIGTERM, shutting down...");
      await handle.shutdown();
      process.exit(0);
    });

    // Log status periodically
    setInterval(() => {
      const snapshot = getZephyrSnapshot();
      if (snapshot.reserveRatio != null) {
        log.info(
          `RR: ${(snapshot.reserveRatio * 100).toFixed(2)}% | ` +
            `Height: ${snapshot.height} | ` +
            `ZEPH: $${snapshot.prices.zephSpot?.toFixed(4)}`
        );
      }
    }, 30_000);
  });

program
  .command("snapshot")
  .description("Get a one-time reserve snapshot")
  .action(async () => {
    log.info("Fetching reserve snapshot...");

    try {
      const raw = await getReserveInfo();
      const rr = parseFloat(raw.reserve_ratio);
      const rrMa = parseFloat(raw.reserve_ratio_ma);

      // Prices from RPC are in atomic units (12 decimals)
      const toUsd = (v: number) => v / 1e12;

      // CLI tabular output — keep as console.log
      console.log("\n=== Zephyr Reserve Snapshot ===");
      console.log(`Height: ${raw.height}`);
      console.log(`Reserve Ratio: ${(rr * 100).toFixed(2)}% (MA: ${(rrMa * 100).toFixed(2)}%)`);
      console.log("\nPrices:");
      console.log(`  ZEPH: $${toUsd(raw.pr.spot).toFixed(4)} (MA: $${toUsd(raw.pr.moving_average).toFixed(4)})`);
      console.log(`  ZSD:  $${toUsd(raw.pr.stable).toFixed(4)} (MA: $${toUsd(raw.pr.stable_ma).toFixed(4)})`);
      console.log(`  ZRS:  $${toUsd(raw.pr.reserve).toFixed(4)} (MA: $${toUsd(raw.pr.reserve_ma).toFixed(4)})`);
      console.log(`  ZYS:  $${toUsd(raw.pr.yield_price).toFixed(4)}`);
      console.log("\nSupply (atomic):");
      console.log(`  ZEPH Reserve: ${(parseFloat(raw.zeph_reserve) / 1e12).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
      console.log(`  ZSD Supply:   ${(parseFloat(raw.num_stables) / 1e12).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
      console.log(`  ZRS Supply:   ${(parseFloat(raw.num_reserves) / 1e12).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
      console.log(`  ZYS Supply:   ${(parseFloat(raw.num_zyield) / 1e12).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
    } catch (error) {
      log.error("Failed to fetch reserve info:", error);
      process.exit(1);
    }
  });

program
  .command("ping")
  .description("Ping zephyrd to check connectivity")
  .action(async () => {
    log.info("Pinging zephyrd...");

    try {
      const raw = await getReserveInfo();
      log.info(`Zephyrd is reachable (height: ${raw.height})`);
    } catch (error) {
      log.error("Failed to reach zephyrd:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);

