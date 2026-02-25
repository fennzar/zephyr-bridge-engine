import { evm } from "@services";
import { createEvmLogger } from "@services/evm/logging";
import type { NetworkEnv } from "@shared";

export type StartUniswapPoolWatcherOptions = {
  network: NetworkEnv;
  startBlock?: bigint;
};

export type UniswapPoolWatcherHandle = {
  runner: evm.UniswapV4WatcherRunner;
  shutdown: () => Promise<void>;
};

export async function startUniswapPoolWatcher(
  options: StartUniswapPoolWatcherOptions,
): Promise<UniswapPoolWatcherHandle> {
  const logger = createEvmLogger("worker:evm");
  const runner = new evm.UniswapV4WatcherRunner({
    network: options.network,
    startBlock: options.startBlock,
    logger,
  });

  const handle = await runner.start();

  const shutdown = async () => {
    await handle.stop();
  };

  return { runner, shutdown };
}
