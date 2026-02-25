import { createLogger } from "@shared/logger";
import { buildGlobalState, type GlobalState } from "@domain/state";
import { loadInventorySnapshot, syncInventoryToDb, type InventorySnapshot } from "@domain/inventory/balances";
import {
  type Strategy,
  ArbitrageStrategy,
  RebalancerStrategy,
  PegKeeperStrategy,
  LPManagerStrategy,
} from "@domain/strategies";
import {
  ExecutionEngine,
  createExecutionEngineFromOptions,
  type ExecutionMode,
} from "@domain/execution";
import {
  CircuitBreaker,
  createRiskLimits,
  type RiskLimits,
} from "@domain/risk";
import { prisma } from "@infra";

import { executePlan, type ExecutionDeps } from "./engine.execution";
import { queueForApproval, processApprovedQueue } from "./engine.queue";

const log = createLogger("Engine");

export interface EngineConfig {
  mode: ExecutionMode;
  manualApproval: boolean;
  strategies: string[];
  loopIntervalMs: number;
  minProfitUsd?: number;
  maxOperationsPerCycle?: number;
  cooldownMs?: number;
}

interface EngineState {
  running: boolean;
  lastCycleAt: Date | null;
  cycleCount: number;
  errorsCount: number;
}

const STRATEGY_REGISTRY: Record<string, () => Strategy> = {
  arb: () => new ArbitrageStrategy(),
  rebalance: () => new RebalancerStrategy(),
  peg: () => new PegKeeperStrategy(),
  lp: () => new LPManagerStrategy(),
};

export class BridgeEngine {
  private config: EngineConfig;
  private strategies: Strategy[] = [];
  private executionEngine: ExecutionEngine | null = null;
  private circuitBreaker: CircuitBreaker;
  private riskLimits: RiskLimits;
  private lastExecutionByKey = new Map<string, Date>();
  private cooldownMs: number;
  private state: EngineState = {
    running: false,
    lastCycleAt: null,
    cycleCount: 0,
    errorsCount: 0,
  };

  constructor(config: EngineConfig) {
    this.config = {
      minProfitUsd: 1.0,
      maxOperationsPerCycle: 5,
      ...config,
    };
    this.cooldownMs = config.cooldownMs ?? 60_000;
    this.riskLimits = createRiskLimits();
    this.circuitBreaker = new CircuitBreaker(this.riskLimits);
    this.initStrategies();
    this.initExecutionEngine();

    if (this.riskLimits.enabled) {
      log.info("Risk controls ENABLED");
    } else {
      log.info("Risk controls DISABLED (testnet mode)");
    }
  }

  private initExecutionEngine() {
    try {
      this.executionEngine = createExecutionEngineFromOptions({
        mode: this.config.mode,
        simulateTiming: this.config.mode === "paper",
        dryRun: false,
      });
      log.info(`Execution engine initialized (mode: ${this.config.mode})`);
    } catch (error) {
      log.warn("Failed to initialize execution engine:", error);
      log.warn("Execution will be logged only, not performed");
    }
  }

  private initStrategies() {
    for (const strategyId of this.config.strategies) {
      const factory = STRATEGY_REGISTRY[strategyId];
      if (factory) {
        this.strategies.push(factory());
        log.info(`Loaded strategy: ${strategyId}`);
      } else {
        log.warn(`Unknown strategy: ${strategyId} (skipped)`);
      }
    }
  }

  async start() {
    this.state.running = true;
    log.info("Starting main loop...");

    while (this.state.running) {
      try {
        await this.runCycle();
      } catch (error) {
        this.state.errorsCount++;
        log.error("Cycle error:", error);
      }

      await this.sleep(this.config.loopIntervalMs);
    }

    log.info("Stopped.");
  }

  async stop() {
    this.state.running = false;
  }

  private async runCycle() {
    this.state.cycleCount++;
    this.state.lastCycleAt = new Date();

    log.info(`\n=== Cycle ${this.state.cycleCount} @ ${this.state.lastCycleAt.toISOString()} ===`);

    // 0. Check EngineSettings (autoExecute + manualApproval + cooldownMs)
    let autoExecute = false;
    let manualApproval = this.config.manualApproval;
    try {
      const settings = await prisma.engineSettings.findFirst({ where: { id: "singleton" } });
      if (settings) {
        autoExecute = settings.autoExecute;
        this.cooldownMs = settings.cooldownMs;
        // DB manualApproval overrides CLI flag when explicitly set
        manualApproval = (settings as Record<string, unknown>).manualApproval as boolean ?? manualApproval;
      }
    } catch {
      // Table may not exist yet — default to autoExecute=false
    }

    // 1. Build global state
    const globalState = await this.buildState();
    if (!globalState) {
      log.warn("Failed to build state, skipping cycle");
      return;
    }

    // 2. Check freshness
    if (!this.isStateFresh(globalState)) {
      log.warn("State data is stale, skipping cycle");
      return;
    }

    // 3. Load inventory
    const inventory = await loadInventorySnapshot();

    // 4. Evaluate each strategy (always runs — keeps state fresh)
    let operationsQueued = 0;
    const maxOps = this.config.maxOperationsPerCycle ?? 5;

    if (!autoExecute) {
      // Still evaluate to keep logs/metrics fresh, but skip execution
      for (const strategy of this.strategies) {
        const evaluation = await strategy.evaluate(globalState, inventory);
        log.info(`[${strategy.id}] Found ${evaluation.opportunities.length} opportunities (auto-execution disabled)`);
      }
    } else {
      for (const strategy of this.strategies) {
        const evaluation = await strategy.evaluate(globalState, inventory);

        log.info(`[${strategy.id}] Found ${evaluation.opportunities.length} opportunities`);

        for (const opportunity of evaluation.opportunities) {
          if (operationsQueued >= maxOps) {
            log.info("Max operations per cycle reached");
            break;
          }

          // Cooldown check: skip if this opportunity was executed recently
          const cooldownKey = `${opportunity.asset}-${opportunity.direction}`;
          const lastExec = this.lastExecutionByKey.get(cooldownKey);
          if (lastExec && Date.now() - lastExec.getTime() < this.cooldownMs) {
            const remaining = Math.round((this.cooldownMs - (Date.now() - lastExec.getTime())) / 1000);
            log.info(`[${cooldownKey}] Cooldown active (${remaining}s remaining)`);
            continue;
          }

          const plan = await strategy.buildPlan(opportunity, globalState, inventory);
          if (!plan) continue;

          if (manualApproval) {
            await queueForApproval(plan, log);
            operationsQueued++;
          } else if (strategy.shouldAutoExecute(plan, this.config)) {
            await executePlan(plan, this.getExecutionDeps(inventory));
            this.lastExecutionByKey.set(cooldownKey, new Date());
            operationsQueued++;
          } else {
            log.info(`[${strategy.id}] Plan did not meet auto-execute criteria`);
          }
        }
      }
    }

    // 5. Process any approved operations from queue
    await processApprovedQueue(this.getExecutionDeps(inventory), maxOps, log);

    // 6. Sync inventory to database
    try {
      const syncResult = await syncInventoryToDb(inventory);
      if (syncResult.synced > 0) {
        log.info(`Synced ${syncResult.synced} inventory balances to DB`);
      }
      if (syncResult.errors > 0) {
        log.warn(`${syncResult.errors} inventory sync errors`);
      }
    } catch (error) {
      log.error("Failed to sync inventory:", error);
    }

    log.info(`Cycle complete. Operations queued: ${operationsQueued}`);
  }

  private getExecutionDeps(inventory?: InventorySnapshot): ExecutionDeps {
    return {
      executionEngine: this.executionEngine,
      circuitBreaker: this.circuitBreaker,
      riskLimits: this.riskLimits,
      mode: this.config.mode,
      log,
      inventory,
    };
  }

  private async buildState(): Promise<GlobalState | null> {
    try {
      return await buildGlobalState();
    } catch (error) {
      log.error("Failed to build global state:", error);
      return null;
    }
  }

  /** Maximum age (ms) before a data source is considered stale. */
  private static readonly STALE_THRESHOLDS = {
    evm: 120_000,     // 2 min
    cex: 60_000,      // 1 min
    zephyr: 300_000,  // 5 min (block time ~2 min)
  };

  private isStateFresh(state: GlobalState): boolean {
    if (!state.zephyr?.reserve) {
      log.warn("Missing Zephyr reserve data");
      return false;
    }

    const now = Date.now();

    // Check EVM watcher freshness
    const evmUpdated = state.evm?.watcher?.lastUpdatedAt ?? state.evm?.watcher?.lastSyncAt;
    if (evmUpdated) {
      const evmAge = now - new Date(evmUpdated).getTime();
      if (evmAge > BridgeEngine.STALE_THRESHOLDS.evm) {
        log.warn(`EVM data stale (${Math.round(evmAge / 1000)}s old)`);
        return false;
      }
    }

    // Check CEX watcher freshness
    const cexUpdated = state.cex?.watcher?.lastUpdatedAt;
    if (cexUpdated) {
      const cexAge = now - cexUpdated;
      if (cexAge > BridgeEngine.STALE_THRESHOLDS.cex) {
        log.warn(`CEX data stale (${Math.round(cexAge / 1000)}s old)`);
        return false;
      }
    }

    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getState() {
    return { ...this.state };
  }

  getRiskState() {
    return {
      circuitBreaker: this.circuitBreaker.getState(),
      riskLimits: this.riskLimits,
    };
  }

  resetCircuitBreaker() {
    log.info("Manual circuit breaker reset requested");
    this.circuitBreaker.reset();
  }
}
