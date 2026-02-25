import type { AssetId } from "@domain/types";
import type { ReserveState } from "@domain/zephyr/reserve";

/**
 * Zephyr protocol snapshot sourced from `mapReserveInfo`.
 */
export interface ZephyrState {
  height: number;
  reserve: ReserveState;
  feesBps: {
    convertZSD: number;
    convertZRS: number;
    convertZYS: number;
  };
  durations: {
    unlockBlocks: number;
    estUnlockTimeMs: number;
  };
}

/**
 * Bridge parameters for wrap/unwrap operations.
 */
export interface BridgeState {
  wrap: {
    gasFee: number;
    minAmount: number;
  };
  unwrap: {
    bridgeFee: number;
    minAmount: number;
  };
}

/**
 * Process state strings surfaced by the pool watcher.
 */
export type EvmWatcherProcessState = "starting" | "historical_sync" | "running" | "stopped" | "error";

/**
 * Runtime snapshot of the watcher process and data freshness.
 */
export interface EvmWatcherSnapshot {
  live: boolean;
  stale: boolean;
  state?: EvmWatcherProcessState;
  wsConnected?: boolean;
  lastSyncAt?: string | null;
  lastActivityAt?: string | null;
  startedAt?: string | null;
  lastUpdatedAt?: string | null;
  pid?: number | null;
}

/**
 * Minimal pool metadata used by the runtime layer.
 */
export interface EvmPool {
  key: string;
  base: AssetId;
  quote: AssetId;
  feeBps: number;
  baseDecimals: number;
  quoteDecimals: number;
  price?: number | null;
  priceInverse?: number | null;
  totalBase?: number | null;
  totalQuote?: number | null;
  tvlUsd?: number | null;
  lastSwapAt?: string | null;
  lastSwapAtMs?: number | null;
  address?: string | null;
  sqrtPriceX96?: bigint | null;
  currentTick?: number | null;
  liquidity?: bigint | null;
  tickSpacing?: number | null;
  ticks?: EvmPoolTick[];
  depthSamples?: EvmPoolDepthSample[];
}

export interface EvmPoolTick {
  tick: number;
  liquidityNet: bigint;
}

export interface EvmPoolDepthSample {
  targetBps: number;
  amountIn: bigint;
  amountOut: bigint;
  resultingTick?: number;
}

/**
 * Aggregated state used by swap runtimes.
 */
export interface EvmState {
  gasPriceWei?: bigint;
  staleAfterMs?: number;
  watcher?: EvmWatcherSnapshot;
  pools: Record<string, EvmPool>;
}

/**
 * Exchange fee and timing information consumed by CEX runtimes.
 */
export interface CexMarketDepthLevel {
  price: number;
  amount: number;
}

export interface CexMarketSnapshot {
  symbol: string;
  base: AssetId;
  quote: AssetId;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  depth?: {
    bids: CexMarketDepthLevel[];
    asks: CexMarketDepthLevel[];
  };
  lastUpdatedAt?: number | null;
}

export interface CexWatcherSnapshot {
  live: boolean;
  stale: boolean;
  lastUpdatedAt?: number | null;
}

export interface CexState {
  fees: {
    takerBps: number;
    makerBps: number;
    zeph: {
      withdrawal: bigint;
    };
    usdt: {
      withdrawal: bigint;
    };
  };
  durations: {
    deposits: {
      zephConfirmations: number;
      usdtConfirmations: number;
    };
    withdrawals: {
      zephEstTimeMs: number;
      usdtEstTimeMs: number;
    };
  };
  markets: Record<string, CexMarketSnapshot>;
  watcher?: CexWatcherSnapshot;
  staleAfterMs?: number;
}

/**
 * Unified snapshot exposed to higher layers.
 */
export interface GlobalState {
  zephyr: ZephyrState;
  bridge?: BridgeState;
  evm?: EvmState;
  cex?: CexState;
}
