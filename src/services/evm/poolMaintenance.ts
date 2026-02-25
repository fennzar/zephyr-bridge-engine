import { prisma } from "@infra";
import { env, type NetworkEnv } from "@shared";

import { resolveDefaultStartBlock } from "./networkConfig";
import { createEvmLogger } from "./logging";
import { UniswapV4WatcherRunner } from "./uniswapV4/runner";
import type { UniswapV4WatcherHandle } from "./uniswapV4/runner";

export type PoolMaintenanceAction = "refresh" | "backfill" | "reset";

export type PoolActionResult = {
  action: PoolMaintenanceAction;
  message: string;
};

export type PoolActionOptions = {
  network?: NetworkEnv;
  fromBlock?: bigint;
};

function resolveNetwork(network?: NetworkEnv): NetworkEnv {
  return network ?? (env.ZEPHYR_ENV as NetworkEnv);
}

function buildCursorKey(network: NetworkEnv): string {
  return `${network}:uniswap_v4_pool_manager`;
}

async function runWatcherCycle(
  action: PoolMaintenanceAction,
  network: NetworkEnv,
  startBlock?: bigint,
): Promise<void> {
  const runner = new UniswapV4WatcherRunner({
    network,
    startBlock,
    logger: createEvmLogger(`maintenance:${action}`),
  });

  let handle: UniswapV4WatcherHandle | undefined;

  try {
    handle = await runner.start();
  } finally {
    if (handle) {
      await handle.stop().catch(() => undefined);
    }
  }
}

export async function performPoolAction(
  action: PoolMaintenanceAction,
  options: PoolActionOptions = {},
): Promise<PoolActionResult> {
  const network = resolveNetwork(options.network);
  const startBlock =
    action === "backfill"
      ? options.fromBlock ?? resolveDefaultStartBlock(network)
      : undefined;

  switch (action) {
    case "refresh": {
      await runWatcherCycle(action, network);
      return {
        action,
        message: "Pool watcher synced latest on-chain logs.",
      };
    }
    case "backfill": {
      await runWatcherCycle(action, network, startBlock);
      const descriptor =
        startBlock !== undefined
          ? `from block ${startBlock.toString()}`
          : "from the configured cursor";
      return {
        action,
        message: `Historical backfill completed ${descriptor}.`,
      };
    }
    case "reset": {
      await prisma.scanCursor
        .delete({
          where: { cursorKey: buildCursorKey(network) },
        })
        .catch(() => undefined);
      return {
        action,
        message:
          "Pool watcher cursor reset. Next run will rescan from the start block.",
      };
    }
    default: {
      throw new Error(`Unsupported pool action ${action}`);
    }
  }
}
