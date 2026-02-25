import { env } from "@shared";

/**
 * Timing mode for execution simulation.
 * - instant: No delays, operations complete immediately.
 * - realistic: Simulates real-world confirmation times.
 */
export type TimingMode = "instant" | "realistic";

/**
 * Configuration for operation timing delays (in milliseconds).
 */
export interface TimingDelays {
  /** MEXC ZEPH deposit confirmation (~20 confirmations @ 2min/block). */
  mexcDepositZeph: number;
  /** MEXC USDT deposit confirmation (~5 min for ERC-20). */
  mexcDepositUsdt: number;
  /** MEXC withdrawal processing time. */
  mexcWithdraw: number;
  /** Zephyr network unlock time (10 blocks). */
  zephyrUnlock: number;
  /** Bridge confirmation time (10 blocks default). */
  bridgeConfirmations: number;
  /** EVM transaction confirmation (1 block). */
  evmConfirmation: number;
  /** CEX trade execution (near-instant). */
  cexTrade: number;
}

/**
 * Complete timing configuration.
 */
export interface TimingConfig {
  mode: TimingMode;
  delays: TimingDelays;
}

/**
 * Realistic timing delays based on actual network/exchange behavior.
 */
const REALISTIC_DELAYS: TimingDelays = {
  mexcDepositZeph: 40 * 60 * 1000, // ~40 minutes (20 confirmations @ 2min)
  mexcDepositUsdt: 5 * 60 * 1000, // ~5 minutes (ERC-20 confirmations)
  mexcWithdraw: 2 * 60 * 1000, // ~2 minutes processing
  zephyrUnlock: 20 * 60 * 1000, // ~20 minutes (10 blocks @ 2min)
  bridgeConfirmations: 20 * 60 * 1000, // ~20 minutes (10 blocks)
  evmConfirmation: 12 * 1000, // ~12 seconds (1 block)
  cexTrade: 500, // ~500ms (near-instant)
};

/**
 * Instant timing - no delays for fast testing.
 */
const INSTANT_DELAYS: TimingDelays = {
  mexcDepositZeph: 0,
  mexcDepositUsdt: 0,
  mexcWithdraw: 0,
  zephyrUnlock: 0,
  bridgeConfirmations: 0,
  evmConfirmation: 0,
  cexTrade: 0,
};

/**
 * Resolve timing mode from environment.
 */
function resolveTimingMode(): TimingMode {
  const envValue = process.env.EXECUTION_TIMING?.toLowerCase();
  if (envValue === "realistic") return "realistic";
  return "instant";
}

/**
 * Get the current timing configuration based on environment.
 */
export function getTimingConfig(): TimingConfig {
  const mode = resolveTimingMode();
  return {
    mode,
    delays: mode === "realistic" ? REALISTIC_DELAYS : INSTANT_DELAYS,
  };
}

/**
 * Get delay for a specific operation type.
 */
export function getOperationDelay(
  operation: keyof TimingDelays,
  config?: TimingConfig,
): number {
  const resolved = config ?? getTimingConfig();
  return resolved.delays[operation];
}

/**
 * Apply a timing delay (only if in realistic mode).
 * Returns immediately in instant mode.
 */
export async function applyDelay(
  operation: keyof TimingDelays,
  config?: TimingConfig,
): Promise<void> {
  const delay = getOperationDelay(operation, config);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

