import { createLogger } from "@shared/logger";
import { prisma } from "@infra";
import { buildGlobalState } from "@domain/state";

const log = createLogger("Status");

export interface EngineStatus {
  timestamp: string;
  database: {
    connected: boolean;
    pendingOperations: number;
    recentExecutions: number;
  };
  state: {
    zephyrAvailable: boolean;
    evmAvailable: boolean;
    cexAvailable: boolean;
    reserveRatio: number | null;
  };
  watchers: {
    mexcHealthy: boolean;
    evmHealthy: boolean;
  };
}

export async function checkStatus(): Promise<EngineStatus> {
  const timestamp = new Date().toISOString();

  // Check database
  let dbConnected = false;
  let pendingOperations = 0;
  let recentExecutions = 0;

  try {
    // Simple query to check connection
    pendingOperations = await prisma.operationQueue.count({
      where: { status: { in: ["pending", "approved"] } },
    });

    recentExecutions = await prisma.executionHistory.count({
      where: {
        startedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    dbConnected = true;
  } catch (error) {
    log.error("Database check failed:", error);
  }

  // Check global state availability
  let zephyrAvailable = false;
  let evmAvailable = false;
  let cexAvailable = false;
  let reserveRatio: number | null = null;

  try {
    const state = await buildGlobalState();
    zephyrAvailable = state.zephyr?.reserve != null;
    evmAvailable = state.evm != null;
    cexAvailable = state.cex != null;
    reserveRatio = state.zephyr?.reserve?.reserveRatio
      ? state.zephyr.reserve.reserveRatio * 100
      : null;
  } catch (error) {
    log.error("State check failed:", error);
  }

  // Check watcher health
  // TODO: Actually ping watcher endpoints
  const mexcHealthy = cexAvailable;
  const evmHealthy = evmAvailable;

  return {
    timestamp,
    database: {
      connected: dbConnected,
      pendingOperations,
      recentExecutions,
    },
    state: {
      zephyrAvailable,
      evmAvailable,
      cexAvailable,
      reserveRatio,
    },
    watchers: {
      mexcHealthy,
      evmHealthy,
    },
  };
}

