import type { AssetId, Venue, OpType } from "@domain/types";
import type { ArbPlanStage } from "@domain/arbitrage/types.plan";

import type { IMexcClient } from "@services/mexc/client";
import type { EvmExecutor } from "@services/evm/executor";
import type { BridgeExecutor } from "@services/bridge/executor";
import type { ZephyrWalletClient } from "@services/zephyr/wallet";

/**
 * Venue executors required by the engine.
 */
export interface VenueExecutors {
  mexc: IMexcClient;
  evm: EvmExecutor;
  bridge: BridgeExecutor;
  zephyr: ZephyrWalletClient;
}

/**
 * Options for building execution steps from a plan.
 */
export interface BuildStepsOptions {
  /** Only include steps from specific stages. */
  stages?: ArbPlanStage[];
  /** Skip blocked steps instead of failing. */
  skipBlocked?: boolean;
  /** Close flavor to use (native or cex). */
  closeFlavor?: "native" | "cex";
}

/**
 * Execution mode:
 * - paper:  pure simulation, zero side effects (no infra required)
 * - devnet: real transactions against local infrastructure (Anvil, devnet wallets, fake orderbook)
 * - live:   real transactions against production (MEXC API, mainnet/sepolia)
 */
export type ExecutionMode = "paper" | "devnet" | "live";

/**
 * Status of an individual execution step.
 */
export type ExecutionStepStatus = "pending" | "running" | "success" | "failed" | "skipped";

/**
 * Context for EVM swap execution (pool address, tokens, fee tier).
 */
export interface SwapContext {
  poolAddress: string;
  token0: string;       // token0 contract address (or AssetId for paper mode)
  token1: string;       // token1 contract address (or AssetId for paper mode)
  fee: number;          // fee tier (e.g., 3000 = 0.3%)
  tickSpacing: number;  // pool tick spacing (e.g., 10, 60, 200)
  hooks: string;        // hook contract address (zero-address if no hooks)
  sqrtPriceLimitX96?: bigint;
}

/**
 * Metadata for LP position operations (mint, burn, collect).
 */
export interface LPStepMetadata {
  positionId?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidityAmount?: bigint;
  token0Amount?: bigint;
  token1Amount?: bigint;
  slippageBps?: number;
}

/**
 * A single step to be executed, derived from an ArbPlan step.
 */
export interface ExecutionStep {
  /** Reference to the originating plan step ID. */
  planStepId: string;
  /** Operation type (swapEVM, tradeCEX, wrap, etc.). */
  op: OpType;
  /** Source asset. */
  from: AssetId;
  /** Destination asset. */
  to: AssetId;
  /** Amount to convert/swap/trade (in source asset's smallest unit). */
  amountIn: bigint;
  /** Venue where this operation executes. */
  venue: Venue;
  /** Optional: expected amount out from planning phase. */
  expectedAmountOut?: bigint;
  /** Optional: EVM swap pool context. */
  swapContext?: SwapContext;
  /** Optional: LP operation metadata. */
  lpMetadata?: LPStepMetadata;
}

/**
 * Result of executing a single step.
 */
export interface ExecutionStepResult {
  /** The step that was executed. */
  step: ExecutionStep;
  /** Final status of this step. */
  status: ExecutionStepStatus;
  /** Actual amount received (in destination asset's smallest unit). */
  amountOut?: bigint;
  /** Transaction hash (for on-chain operations). */
  txHash?: string;
  /** Order ID (for CEX operations). */
  orderId?: string;
  /** Error message if failed. */
  error?: string;
  /** Time taken to execute this step in milliseconds. */
  durationMs: number;
  /** ISO timestamp when execution completed. */
  timestamp: string;
  /** Gas used (for EVM operations). */
  gasUsed?: bigint;
  /** Fee paid (venue-specific). */
  feePaid?: bigint;
}

/**
 * Summary statistics for an execution run.
 */
export interface ExecutionSummary {
  /** Number of steps that succeeded. */
  succeeded: number;
  /** Number of steps that failed. */
  failed: number;
  /** Number of steps that were skipped. */
  skipped: number;
  /** Total execution time in milliseconds. */
  totalDurationMs: number;
  /** Total gas used across all EVM operations. */
  totalGasUsed?: bigint;
  /** Net asset changes from this execution. */
  netAssetChanges?: Partial<Record<AssetId, bigint>>;
}

/**
 * Complete result of executing an arbitrage plan.
 */
export interface ExecutionResult {
  /** Unique ID for this execution run. */
  executionId: string;
  /** Reference to the plan that was executed. */
  planId: string;
  /** Mode this was executed in. */
  mode: ExecutionMode;
  /** Results for each step. */
  steps: ExecutionStepResult[];
  /** Summary statistics. */
  summary: ExecutionSummary;
  /** ISO timestamp when execution started. */
  startedAt: string;
  /** ISO timestamp when execution completed. */
  completedAt: string;
}

/**
 * Context passed to venue executors.
 */
export interface ExecutionContext {
  /** Execution mode. */
  mode: ExecutionMode;
  /** Whether to simulate timing delays. */
  simulateTiming: boolean;
  /** Dry run - validate but don't execute. */
  dryRun?: boolean;
}

/**
 * Generic result type for venue-specific operations.
 */
export interface VenueOperationResult {
  success: boolean;
  txHash?: string;
  orderId?: string;
  amountOut?: bigint;
  error?: string;
  durationMs: number;
  gasUsed?: bigint;
  feePaid?: bigint;
}

