import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type {
  BridgeState,
  GlobalState,
  ZephyrState,
  EvmState,
  EvmPool,
  CexState,
  CexMarketSnapshot,
} from "@domain/state/types";
import type { ReserveState } from "@domain/zephyr/reserve";
import type { AssetId } from "@domain/types";
import type { InventoryBalances } from "@domain/pathing/types";
import type {
  InventorySnapshot,
  InventorySourceOptions,
  InventoryAssetTotals,
} from "@domain/inventory/balances";
import type {
  OperationPlan,
  StrategyOpportunity,
  EngineConfig,
  RRMode,
} from "@domain/strategies/types";
import type { ExecutionStep } from "@domain/execution/types";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function createMockBridgeState(overrides: DeepPartial<BridgeState> = {}): BridgeState {
  const base: BridgeState = {
    wrap: {
      gasFee: 0,
      minAmount: 0,
    },
    unwrap: {
      bridgeFee: 0,
      minAmount: 0,
    },
  };
  return merge(base, overrides);
}

export function createMockReserveState(overrides: DeepPartial<ReserveState> = {}): ReserveState {
  const base: ReserveState = {
    height: 0,
    zrsCirc: 0,
    zsdCirc: 0,
    zysCirc: 0,
    zephInReserve: 0,
    zsdInYieldReserve: 0,
    zephPriceUsd: 0.75,
    rates: {
      zeph: { base: "ZEPH", quote: "USD", spot: 0.75, movingAverage: 0.75 },
      zrs: {
        base: "ZRS",
        quote: "ZEPH",
        spot: 1,
        movingAverage: 1,
        mint: 1,
        redeem: 1,
        spotUSD: 0.75,
      },
      zsd: {
        base: "ZSD",
        quote: "ZEPH",
        spot: 1,
        movingAverage: 1,
        mint: 1,
        redeem: 1,
        spotUSD: 1,
      },
      zys: {
        base: "ZYS",
        quote: "ZSD",
        spot: 1,
        movingAverage: 1,
        mint: 1,
        redeem: 1,
        spotUSD: 1,
      },
    },
    reserveRatio: 5.0,
    reserveRatioMovingAverage: 5.0,
    policy: {
      zsd: { mintable: true, redeemable: true },
      zrs: { mintable: true, redeemable: true },
    },
  };
  return merge(base, overrides);
}

export function createMockZephyrState(overrides: DeepPartial<ZephyrState> = {}): ZephyrState {
  const base: ZephyrState = {
    height: 0,
    reserve: createMockReserveState(),
    feesBps: {
      convertZSD: 0,
      convertZRS: 0,
      convertZYS: 0,
    },
    durations: {
      unlockBlocks: 0,
      estUnlockTimeMs: 0,
    },
  };
  return merge(base, overrides);
}

export function createMockGlobalState(overrides: DeepPartial<GlobalState> = {}): GlobalState {
  const base: GlobalState = {
    zephyr: createMockZephyrState(),
    bridge: createMockBridgeState(),
    evm: undefined,
    cex: undefined,
  };
  return merge(base, overrides);
}

export function createBridgeContext(
  direction: "wrap" | "unwrap",
  overrides: DeepPartial<BridgeOperationContext> = {},
): BridgeOperationContext {
  const baseBridge = overrides.bridge ?? createMockBridgeState();
  const pair = overrides.pair ?? { native: "ZEPH.n" as const, wrapped: "WZEPH.e" as const };
  const fromAsset = direction === "wrap" ? pair.native : pair.wrapped;
  const toAsset = direction === "wrap" ? pair.wrapped : pair.native;
  const base: BridgeOperationContext = {
    direction,
    bridge: baseBridge,
    from: fromAsset,
    to: toAsset,
    pair,
    fromDecimals: overrides.fromDecimals ?? 12,
    toDecimals: overrides.toDecimals ?? 12,
    minAmountFrom: overrides.minAmountFrom ?? 1n,
    flatFeeFrom: overrides.flatFeeFrom,
    flatFeeTo: overrides.flatFeeTo,
  };
  return merge(base, overrides);
}

function merge<T>(target: T, source: DeepPartial<T>): T {
  for (const key of Object.keys(source) as Array<keyof T>) {
    const value = source[key];
    if (value === undefined) continue;
    if (isPlainObject(target[key]) && isPlainObject(value)) {
      // @ts-expect-error recursive merge
      target[key] = merge({ ...(target[key] as object) }, value);
    } else {
      target[key] = value as T[typeof key];
    }
  }
  return target;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && value.constructor === Object;
}

// ---------------------------------------------------------------------------
// EVM factories
// ---------------------------------------------------------------------------

export function createMockEvmPool(overrides: DeepPartial<EvmPool> = {}): EvmPool {
  const base: EvmPool = {
    key: "USDT.e::WZSD.e",
    base: "WZSD.e",
    quote: "USDT.e",
    feeBps: 1,
    baseDecimals: 12,
    quoteDecimals: 6,
    price: 1.0,
    priceInverse: 1.0,
    address: "0x1111111111111111111111111111111111111111",
    tickSpacing: 1,
  };
  return merge(base, overrides);
}

export function createMockEvmState(overrides: DeepPartial<EvmState> = {}): EvmState {
  const base: EvmState = {
    pools: {},
  };
  return merge(base, overrides);
}

// ---------------------------------------------------------------------------
// CEX factories
// ---------------------------------------------------------------------------

export function createMockCexState(overrides: DeepPartial<CexState> = {}): CexState {
  const base: CexState = {
    fees: {
      takerBps: 10,
      makerBps: 5,
      zeph: { withdrawal: 0n },
      usdt: { withdrawal: 0n },
    },
    durations: {
      deposits: { zephConfirmations: 10, usdtConfirmations: 6 },
      withdrawals: { zephEstTimeMs: 600_000, usdtEstTimeMs: 300_000 },
    },
    markets: {},
  };
  return merge(base, overrides);
}

export function createMockCexMarket(overrides: DeepPartial<CexMarketSnapshot> = {}): CexMarketSnapshot {
  const base: CexMarketSnapshot = {
    symbol: "ZEPH_USDT",
    base: "ZEPH.x",
    quote: "USDT.x",
    bid: 0.745,
    ask: 0.755,
    last: 0.75,
  };
  return merge(base, overrides);
}

// ---------------------------------------------------------------------------
// Inventory factories
// ---------------------------------------------------------------------------

export function createMockInventorySnapshot(
  balances: Partial<Record<AssetId, number>> = {},
): InventorySnapshot {
  const totals: InventoryAssetTotals = {};
  // Simple sum by base asset
  for (const [id, amount] of Object.entries(balances) as [AssetId, number][]) {
    const base = id.replace(/^W/, "").replace(/\.[enx]$/, "") as keyof InventoryAssetTotals;
    totals[base] = (totals[base] ?? 0) + amount;
  }
  return {
    balances: balances as InventoryBalances,
    totals,
    options: { includeEvm: true, includePaperMexc: true, includePaperZephyr: true },
  };
}

// ---------------------------------------------------------------------------
// Convenience state builders
// ---------------------------------------------------------------------------

/** Full normal-mode state with 4 pools + CEX, RR=5.0. */
export function createNormalModeState(overrides: DeepPartial<GlobalState> = {}): GlobalState {
  const base: GlobalState = {
    zephyr: createMockZephyrState({
      reserve: createMockReserveState({
        reserveRatio: 5.0,
        reserveRatioMovingAverage: 5.0,
        zephPriceUsd: 0.75,
        policy: { zsd: { mintable: true, redeemable: true }, zrs: { mintable: true, redeemable: true } },
      }),
    }),
    bridge: createMockBridgeState(),
    evm: {
      pools: {
        "USDT.e::WZSD.e": createMockEvmPool({
          key: "USDT.e::WZSD.e", base: "WZSD.e", quote: "USDT.e",
          feeBps: 100, price: 1.0, priceInverse: 1.0,
          address: "0xaaa1111111111111111111111111111111111111",
        }),
        "WZEPH.e::WZSD.e": createMockEvmPool({
          key: "WZEPH.e::WZSD.e", base: "WZEPH.e", quote: "WZSD.e",
          feeBps: 3000, price: 0.75, priceInverse: 1 / 0.75,
          baseDecimals: 12, quoteDecimals: 12,
          address: "0xaaa2222222222222222222222222222222222222",
        }),
        "WZEPH.e::WZRS.e": createMockEvmPool({
          key: "WZEPH.e::WZRS.e", base: "WZRS.e", quote: "WZEPH.e",
          feeBps: 3000, price: 2.0, priceInverse: 0.5,
          baseDecimals: 12, quoteDecimals: 12,
          address: "0xaaa3333333333333333333333333333333333333",
        }),
        "WZSD.e::WZYS.e": createMockEvmPool({
          key: "WZSD.e::WZYS.e", base: "WZYS.e", quote: "WZSD.e",
          feeBps: 500, price: 1.1, priceInverse: 1 / 1.1,
          baseDecimals: 12, quoteDecimals: 12,
          address: "0xaaa4444444444444444444444444444444444444",
        }),
      },
    },
    cex: createMockCexState({
      markets: {
        ZEPH_USDT: createMockCexMarket({ bid: 0.745, ask: 0.755 }),
      },
    }),
  };
  return merge(base, overrides);
}

/** State configured for a specific RR mode with appropriate policies. */
export function createStateForRRMode(
  mode: RRMode,
  overrides: DeepPartial<GlobalState> = {},
): GlobalState {
  const rrConfig: Record<RRMode, { reserveRatio: number; policy: ReserveState["policy"] }> = {
    normal: {
      reserveRatio: 5.0,
      policy: { zsd: { mintable: true, redeemable: true }, zrs: { mintable: true, redeemable: true } },
    },
    defensive: {
      reserveRatio: 3.0,
      policy: { zsd: { mintable: false, redeemable: true }, zrs: { mintable: false, redeemable: false } },
    },
    crisis: {
      reserveRatio: 1.5,
      policy: { zsd: { mintable: false, redeemable: true }, zrs: { mintable: false, redeemable: false } },
    },
  };
  const cfg = rrConfig[mode];
  return createNormalModeState(merge({
    zephyr: {
      reserve: {
        reserveRatio: cfg.reserveRatio,
        reserveRatioMovingAverage: cfg.reserveRatio,
        policy: cfg.policy,
      },
    },
  } as DeepPartial<GlobalState>, overrides));
}

// ---------------------------------------------------------------------------
// OperationPlan builder for shouldAutoExecute testing
// ---------------------------------------------------------------------------

export function buildTestPlan(overrides: {
  asset?: string;
  direction?: string;
  rrMode?: RRMode;
  pnl?: number;
  spreadBps?: number;
  strategy?: string;
  cost?: number;
} = {}): OperationPlan {
  const asset = overrides.asset ?? "ZEPH";
  const direction = overrides.direction ?? "evm_premium";
  const rrMode = overrides.rrMode ?? "normal";
  const pnl = overrides.pnl ?? 50;

  const opportunity: StrategyOpportunity = {
    id: `test-${asset}-${direction}`,
    strategy: overrides.strategy ?? "arb",
    trigger: `Test ${asset} ${direction}`,
    asset,
    direction,
    expectedPnl: pnl,
    urgency: "medium",
    context: { rrMode, reserveRatio: rrMode === "normal" ? 5.0 : rrMode === "defensive" ? 3.0 : 1.5 },
  };

  return {
    id: opportunity.id,
    strategy: overrides.strategy ?? "arb",
    opportunity,
    steps: [],
    estimatedCost: overrides.cost ?? 10,
    estimatedDuration: 60_000,
    reserveRatio: opportunity.context?.reserveRatio as number,
    spotMaSpreadBps: overrides.spreadBps ?? 0,
  };
}

export function buildTestConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    mode: "devnet",
    manualApproval: false,
    strategies: ["arb"],
    loopIntervalMs: 30_000,
    ...overrides,
  };
}
