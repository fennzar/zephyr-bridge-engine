#!/usr/bin/env node
import { Command } from "commander";
import { env, type NetworkEnv } from "@shared";
import { createLogger } from "@shared/logger";
import type { ExecutionMode } from "@domain/execution/types";
import { BridgeEngine, type EngineConfig } from "./engine";
import type { SeedConfig } from "@services/evm/poolSeeder";

const log = createLogger("CLI");

const program = new Command();

program
  .name("zephyr-engine")
  .description("Zephyr Bridge Engine - Operations orchestrator")
  .version("0.2.0");

program
  .command("run")
  .description("Start the bridge engine")
  .option("--mode <mode>", "Execution mode: paper | devnet | live", "devnet")
  .option("--auto", "Auto-execute operations that pass risk checks", false)
  .option(
    "--strategies <list>",
    "Comma-separated strategies to enable",
    "arb,rebalance,peg,lp"
  )
  .option(
    "--interval <ms>",
    "Loop interval in milliseconds",
    "10000"
  )
  .option(
    "--cooldown <ms>",
    "Minimum time between executions of the same opportunity (ms)",
    "60000"
  )
  .action(async (opts) => {
    const config: EngineConfig = {
      mode: opts.mode as ExecutionMode,
      manualApproval: !opts.auto,
      strategies: opts.strategies.split(",").map((s: string) => s.trim()),
      loopIntervalMs: parseInt(opts.interval, 10),
      cooldownMs: parseInt(opts.cooldown, 10),
    };

    const modeLabels: Record<ExecutionMode, string> = {
      paper: "paper (simulated)",
      devnet: "devnet (local)",
      live: "live (production)",
    };
    const modeLabel = modeLabels[config.mode] ?? config.mode;

    console.log("╔════════════════════════════════════════════╗");
    console.log("║       ZEPHYR BRIDGE ENGINE                 ║");
    console.log("╠════════════════════════════════════════════╣");
    console.log(`║  Mode:       ${modeLabel.padEnd(28)}║`);
    console.log(`║  Approval:   ${(config.manualApproval ? "manual" : "auto").padEnd(28)}║`);
    console.log(`║  Strategies: ${config.strategies.join(", ").padEnd(28)}║`);
    console.log(`║  Interval:   ${(config.loopIntervalMs + "ms").padEnd(28)}║`);
    console.log(`║  Cooldown:   ${(config.cooldownMs + "ms").padEnd(28)}║`);
    console.log("╚════════════════════════════════════════════╝");

    const engine = new BridgeEngine(config);

    // Graceful shutdown
    const shutdown = async () => {
      log.info("Shutting down engine...");
      await engine.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await engine.start();
  });

program
  .command("evaluate")
  .description("One-shot evaluation of all strategies (no execution)")
  .option("--strategies <list>", "Strategies to evaluate", "arb,rebalance,peg,lp")
  .action(async (opts) => {
    const { evaluateAll } = await import("./evaluate");
    const strategies = opts.strategies.split(",").map((s: string) => s.trim());
    
    log.info(`Evaluating strategies: ${strategies.join(", ")}`);
    const result = await evaluateAll(strategies);

    console.log("\n=== Evaluation Results ===\n");  // decorative banner
    console.log(JSON.stringify(result, null, 2));   // structured output
  });

program
  .command("status")
  .description("Check engine and watcher status")
  .action(async () => {
    const { checkStatus } = await import("./status");
    const status = await checkStatus();
    console.log(JSON.stringify(status, null, 2));  // structured output
  });

program
  .command("setup")
  .description("Seed initial pool liquidity (wrap native assets + place LP)")
  .option("--dry-run", "Print plan without executing", false)
  .option("--skip-wrap", "Skip wrapping (tokens already on EVM)", false)
  .option("--pools <ids>", "Seed specific pools only (comma-separated)")
  .action(async (opts) => {
    const setupLog = createLogger("Setup");

    const { getNetworkConfig } = await import("@services/evm/config");
    const { PoolSeeder } = await import("@services/evm/poolSeeder");
    const {
      createEvmExecutor,
      createZephyrWalletClient,
      createBridgeExecutor,
      createBridgeApiClient,
    } = await import("@domain/execution/factory");

    const network = env.ZEPHYR_ENV as NetworkEnv;
    const config = getNetworkConfig(network);

    if (!config.pools || config.pools.length === 0) {
      setupLog.error("No pool plans found in address config");
      process.exit(1);
    }

    // Filter pools if --pools flag provided
    let poolPlans = config.pools
      .filter((p) => p.plan != null)
      .map((p) => p.plan!);

    if (opts.pools) {
      const ids = opts.pools.split(",").map((s: string) => s.trim().toLowerCase());
      poolPlans = poolPlans.filter((plan) => {
        const poolId = `${plan.pricing.base}-${plan.pricing.quote}`.toLowerCase();
        return ids.some(
          (id: string) =>
            poolId.includes(id) ||
            plan.pricing.base.toLowerCase().includes(id) ||
            plan.pricing.quote.toLowerCase().includes(id),
        );
      });
      if (poolPlans.length === 0) {
        setupLog.error(`No pools matched filter: ${opts.pools}`);
        process.exit(1);
      }
    }

    // Read wrap amounts from config's seeding section (written by patch-pool-prices.py)
    const seeding = (config as Record<string, unknown>).seeding as
      | { wrapAmounts?: Record<string, number> }
      | undefined;
    const wrapAmounts: Record<string, bigint> = seeding?.wrapAmounts
      ? {
          ZEPH: BigInt(seeding.wrapAmounts.ZPH ?? 80000) * 10n ** 12n,
          ZSD: BigInt(seeding.wrapAmounts.ZSD ?? 80000) * 10n ** 12n,
          ZRS: BigInt(seeding.wrapAmounts.ZRS ?? 30000) * 10n ** 12n,
          ZYS: BigInt(seeding.wrapAmounts.ZYS ?? 30000) * 10n ** 12n,
        }
      : {
          ZEPH: 80000n * 10n ** 12n,
          ZSD: 80000n * 10n ** 12n,
          ZRS: 30000n * 10n ** 12n,
          ZYS: 30000n * 10n ** 12n,
        };

    // Exclude USDT-USDC (seeded by deployer in deploy-contracts.sh)
    poolPlans = poolPlans.filter((plan) => {
      const id = `${plan.pricing.base}-${plan.pricing.quote}`;
      return id !== "USDT-USDC";
    });

    const seedConfig: SeedConfig = { wrapAmounts, poolPlans };

    // Create executors
    const evmExecutor = createEvmExecutor();
    const zephyrWallet = createZephyrWalletClient();
    const bridgeExecutor = createBridgeExecutor(zephyrWallet, evmExecutor);
    const bridgeApiClient = createBridgeApiClient();

    const seeder = new PoolSeeder(
      evmExecutor,
      bridgeExecutor,
      bridgeApiClient,
      zephyrWallet,
      network,
    );

    if (opts.dryRun) {
      setupLog.info("Dry run — printing plan without executing");
      const plan = seeder.dryRun(seedConfig);
      console.log("\n=== Pool Seeding Plan ===\n");
      const bigIntReplacer = (_k: string, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v;
      console.log(JSON.stringify(plan, bigIntReplacer, 2));
      return;
    }

    setupLog.info(
      `Seeding ${poolPlans.length} pool(s), skipWrap=${opts.skipWrap}`,
    );
    const result = await seeder.seedAll(seedConfig, {
      skipWrap: opts.skipWrap,
    });

    console.log("\n=== Seeding Results ===\n");
    const bigIntReplacer = (_k: string, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v;
    console.log(JSON.stringify(result, bigIntReplacer, 2));

    // Scan pools so bridge-web discovers them (even if some pools failed)
    await seeder.scanPools(env.ADMIN_TOKEN);

    if (!result.success) {
      // Check if any pools succeeded — partial success is OK for devnet
      const poolResults = result.pools ?? [];
      const successCount = poolResults.filter((p: { success: boolean }) => p.success).length;
      if (successCount > 0) {
        setupLog.warn(
          `${successCount}/${poolResults.length} pools seeded (some failed, continuing)`,
        );
      } else {
        setupLog.error("All pools failed to seed");
        process.exit(1);
      }
    }
  });

program.parseAsync();

