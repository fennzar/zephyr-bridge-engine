/**
 * Factory for creating venue executors.
 */

import { env } from "@shared";
import type { Hex } from "viem";
import type { ExecutionMode, ExecutionContext } from "./types";
import { ExecutionEngine, type VenueExecutors } from "./engine";

// Import venue-specific executors/clients
import { CexWalletClient } from "@services/cex/client";
import { MexcLiveClient } from "@services/mexc/live";
import type { IMexcClient } from "@services/mexc/client";
import { EvmExecutor } from "@services/evm/executor";
import { BridgeExecutor } from "@services/bridge/executor";
import { BridgeApiClient } from "@services/bridge/apiClient";
import { ZephyrWalletClient } from "@services/zephyr/wallet";

/**
 * Options for creating an execution engine.
 */
export interface CreateEngineOptions {
  mode: ExecutionMode;
  simulateTiming?: boolean;
  dryRun?: boolean;
  /** EVM private key for signing transactions (required for live mode) */
  evmPrivateKey?: Hex;
}

/**
 * Create the appropriate MEXC client based on mode.
 *
 * - paper/devnet → CexWalletClient (accounting-only trades, real wallet balances)
 * - live → MexcLiveClient (unless MEXC_PAPER override is set)
 */
export function createMexcClient(mode: ExecutionMode): IMexcClient {
  if (mode === "live" && !env.MEXC_PAPER) {
    return new MexcLiveClient();
  }
  return new CexWalletClient(mode);
}

/**
 * Create an EVM executor for the current network.
 * Requires a private key for signing transactions.
 */
export function createEvmExecutor(privateKey?: Hex): EvmExecutor {
  const raw = privateKey ?? env.EVM_PRIVATE_KEY;
  if (!raw) {
    throw new Error("EVM private key required for execution");
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return new EvmExecutor(key);
}

/**
 * Create a Zephyr wallet client.
 * Uses module-level RPC configuration.
 */
export function createZephyrWalletClient(): ZephyrWalletClient {
  return new ZephyrWalletClient();
}

/**
 * Create a bridge API client for interacting with the bridge-api service.
 */
export function createBridgeApiClient(): BridgeApiClient {
  const url = env.BRIDGE_API_URL ?? "http://localhost:5557";
  return new BridgeApiClient(url);
}

/**
 * Create a bridge executor.
 */
export function createBridgeExecutor(
  zephyrWallet: ZephyrWalletClient,
  evmExecutor: EvmExecutor,
): BridgeExecutor {
  return new BridgeExecutor(zephyrWallet, evmExecutor);
}

/**
 * Create all venue executors for the given mode.
 * May throw if required credentials are missing.
 */
export function createVenueExecutors(mode: ExecutionMode, evmPrivateKey?: Hex): VenueExecutors {
  const mexc = createMexcClient(mode);
  const evm = createEvmExecutor(evmPrivateKey);
  const zephyr = createZephyrWalletClient();
  const bridge = createBridgeExecutor(zephyr, evm);

  return { mexc, evm, bridge, zephyr };
}

/**
 * Create a fully configured execution engine.
 * May throw if required credentials are missing for the selected mode.
 */
export function createExecutionEngineFromOptions(
  options: CreateEngineOptions,
): ExecutionEngine {
  const executors = createVenueExecutors(options.mode, options.evmPrivateKey);
  
  const context: ExecutionContext = {
    mode: options.mode,
    simulateTiming: options.simulateTiming ?? false,
    dryRun: options.dryRun ?? false,
  };

  return new ExecutionEngine(executors, context);
}

