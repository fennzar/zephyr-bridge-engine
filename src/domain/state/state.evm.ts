import type { AssetId } from "@domain/types";
import { getPoolWatcherStatus, getPools } from "@services/evm/uniswapV4";
import { getEvmWatcherHealth } from "@services/evm/watcherHealth";
import type { EvmWatcherHealth } from "@services/evm/watcherHealth";
import { makePublicClient } from "@services/evm/viemClient";
import { getNetworkConfig } from "@services/evm/config";
import stateViewAbi from "@services/evm/abis/stateView";
import { env, type NetworkEnv } from "@shared";
import type { Hex } from "viem";

import type { EvmPool, EvmState } from "./types";

export const DEFAULT_EVM_POOL_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_POOL_FEE_BPS = 30;

const REQUIRED_POOL_PAIRS: Array<{ a: AssetId; b: AssetId; defaultFeeBps?: number }> = [
  { a: "WZEPH.e", b: "WZSD.e", defaultFeeBps: DEFAULT_POOL_FEE_BPS },
  { a: "WZEPH.e", b: "WZRS.e", defaultFeeBps: DEFAULT_POOL_FEE_BPS },
  { a: "WZSD.e", b: "USDT.e", defaultFeeBps: DEFAULT_POOL_FEE_BPS },
  { a: "WZSD.e", b: "WZYS.e", defaultFeeBps: DEFAULT_POOL_FEE_BPS },
];

const SYMBOL_TO_ASSET: Partial<Record<string, AssetId>> = {
  WZEPH: "WZEPH.e",
  WZSD: "WZSD.e",
  WZRS: "WZRS.e",
  WZYS: "WZYS.e",
  USDT: "USDT.e",
};

const ASSET_DECIMALS: Partial<Record<AssetId, number>> = {
  "USDT.e": 6,
  "WZSD.e": 12,
  "WZEPH.e": 12,
  "WZRS.e": 12,
  "WZYS.e": 12,
};

type PoolWatcherStatusResult = Awaited<ReturnType<typeof getPoolWatcherStatus>>;

const LIVE_WATCHER_STATES: ReadonlySet<EvmWatcherHealth["state"]> = new Set([
  "running",
  "historical_sync",
]);

export async function buildEvmState(): Promise<EvmState> {
  const pools: EvmState["pools"] = {};

  const [poolOverviews, watcherStatus, watcherHealth, gasPriceWei] = await Promise.all([
    getPools().catch(() => [] as Awaited<ReturnType<typeof getPools>>),
    getPoolWatcherStatus(env.ZEPHYR_ENV).catch(() => null as PoolWatcherStatusResult | null),
    getEvmWatcherHealth().catch(() => null as EvmWatcherHealth | null),
    fetchGasPriceWei(),
  ]);

  for (const overview of poolOverviews) {
    const baseSymbol = overview.base.symbol?.replace(".e", "").toUpperCase();
    const quoteSymbol = overview.quote.symbol?.replace(".e", "").toUpperCase();
    const baseAsset = baseSymbol ? SYMBOL_TO_ASSET[baseSymbol] : undefined;
    const quoteAsset = quoteSymbol ? SYMBOL_TO_ASSET[quoteSymbol] : undefined;
    if (!baseAsset || !quoteAsset) continue;

    const key = poolKey(baseAsset, quoteAsset);
    const feeBps = Number.isFinite(overview.feeBps) ? overview.feeBps ?? DEFAULT_POOL_FEE_BPS : DEFAULT_POOL_FEE_BPS;
    const totalBase = isFiniteNumber(overview.totalToken0) ? overview.totalToken0 : null;
    const totalQuote = isFiniteNumber(overview.totalToken1) ? overview.totalToken1 : null;
    const tvlUsd = isFiniteNumber((overview as { tvlUsd?: number }).tvlUsd) ? (overview as { tvlUsd?: number }).tvlUsd! : null;
    const lastSwapAt = overview.lastSwapAt ?? null;
    const parsedLastSwap = lastSwapAt ? Date.parse(lastSwapAt) : NaN;
    const lastSwapAtMs = Number.isFinite(parsedLastSwap) ? parsedLastSwap : null;

    const rawPrice = isFiniteNumber(overview.lastPrice) && overview.lastPrice > 0 ? overview.lastPrice : null;
    const rawPriceInverse =
      isFiniteNumber(overview.lastPriceInverse) && overview.lastPriceInverse > 0
        ? overview.lastPriceInverse
        : null;
    const derivedPrice = rawPrice ?? (rawPriceInverse ? 1 / rawPriceInverse : null);
    const derivedPriceInverse = rawPriceInverse ?? (rawPrice ? 1 / rawPrice : null);

    const candidatePool: EvmPool = {
      key,
      base: baseAsset,
      quote: quoteAsset,
      feeBps,
      baseDecimals: fallbackDecimals(baseAsset, overview.base.decimals),
      quoteDecimals: fallbackDecimals(quoteAsset, overview.quote.decimals),
      price: derivedPrice,
      priceInverse: derivedPriceInverse,
      totalBase,
      totalQuote,
      tvlUsd,
      lastSwapAt,
      lastSwapAtMs,
      address: overview.id ?? null,
      tickSpacing:
        typeof overview.tickSpacing === "number" ? overview.tickSpacing : null,
      currentTick:
        typeof overview.currentTick === "number"
          ? overview.currentTick
          : typeof overview.lastTick === "number"
            ? overview.lastTick
            : null,
      liquidity: overview.liquidity ? readBigInt(overview.liquidity) : null,
      sqrtPriceX96: (() => {
        if (typeof overview.sqrtPriceX96 === "string") {
          try {
            return BigInt(overview.sqrtPriceX96);
          } catch {
            return undefined;
          }
        }
        return undefined;
      })(),
      ticks: overview.ticks?.map((tick) => ({
        tick: tick.tick,
        liquidityNet: readBigInt(tick.liquidityNet) ?? 0n,
      })),
      depthSamples: overview.depthSamples?.map((sample) => ({
        targetBps: sample.targetBps,
        amountIn: readBigInt(sample.amountIn) ?? 0n,
        amountOut: readBigInt(sample.amountOut) ?? 0n,
        resultingTick: sample.resultingTick,
      })),
    };

    if (shouldReplacePool(pools[key], candidatePool)) {
      pools[key] = candidatePool;
    }
  }

  for (const { a, b, defaultFeeBps } of REQUIRED_POOL_PAIRS) {
    const key = poolKey(a, b);
    if (!pools[key]) {
      pools[key] = {
        key,
        base: a,
        quote: b,
        feeBps: defaultFeeBps ?? DEFAULT_POOL_FEE_BPS,
        baseDecimals: fallbackDecimals(a),
        quoteDecimals: fallbackDecimals(b),
        price: null,
        priceInverse: null,
        totalBase: null,
        totalQuote: null,
        tvlUsd: null,
        lastSwapAt: null,
        lastSwapAtMs: null,
        address: null,
        tickSpacing: null,
        currentTick: null,
        liquidity: null,
        sqrtPriceX96: undefined,
        ticks: undefined,
        depthSamples: undefined,
      };
    }
  }

  try {
    await enrichPoolsWithStateView(pools);
  } catch {
    // ignore state view enrichment errors; snapshot data remains usable without it
  }

  const staleAfterMs = DEFAULT_EVM_POOL_STALE_AFTER_MS;
  const watcherSnapshot = buildWatcherSnapshot(watcherStatus, watcherHealth, staleAfterMs);

  return {
    gasPriceWei: gasPriceWei ?? undefined,
    staleAfterMs,
    watcher: watcherSnapshot ?? undefined,
    pools,
  };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function poolKey(a: AssetId, b: AssetId): string {
  return [a, b].sort().join("::");
}

function fallbackDecimals(asset: AssetId, provided?: number): number {
  if (typeof provided === "number" && Number.isFinite(provided) && provided >= 0) {
    return provided;
  }
  return ASSET_DECIMALS[asset] ?? 12;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.length > 0) {
    try {
      const normalized = value.startsWith("0x") || value.startsWith("0X") ? value : value.split(".")[0] ?? value;
      return BigInt(normalized);
    } catch {
      return null;
    }
  }
  return null;
}

async function enrichPoolsWithStateView(pools: Record<string, EvmPool>): Promise<void> {
  const candidates = Object.values(pools).filter((pool) => typeof pool.address === "string" && pool.address.startsWith("0x"));
  if (candidates.length === 0) return;

  const networkEnv = env.ZEPHYR_ENV as NetworkEnv;
  const config = getNetworkConfig(networkEnv);
  const stateViewAddress = config.contracts?.stateView;
  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL;
  if (!stateViewAddress || !rpcUrl) return;

  const client = makePublicClient(rpcUrl, networkEnv);

  for (const pool of candidates) {
    const poolId = pool.address as Hex;

    const [slot0Result, liquidityResult] = await Promise.allSettled([
      client.readContract({
        address: stateViewAddress as Hex,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      client.readContract({
        address: stateViewAddress as Hex,
        abi: stateViewAbi,
        functionName: "getLiquidity",
        args: [poolId],
      }),
    ]);

    if (slot0Result.status === "fulfilled") {
      const slotTuple = slot0Result.value as readonly [bigint, number, number?, number?];
      const sqrtPriceX96 = slotTuple?.[0];
      const tick = slotTuple?.[1];
      if (sqrtPriceX96 != null) {
        pool.sqrtPriceX96 = BigInt(sqrtPriceX96);
      }
      if (typeof tick === "number" && Number.isFinite(tick)) {
        pool.currentTick = tick;
        const price = priceFromTick(tick, pool.baseDecimals, pool.quoteDecimals);
        if (price != null) {
          pool.price = price;
          pool.priceInverse = price > 0 ? 1 / price : null;
        }
      }
    }

    if (liquidityResult.status === "fulfilled") {
      const liquidityRaw = liquidityResult.value as bigint | undefined;
      if (liquidityRaw != null) {
        pool.liquidity = BigInt(liquidityRaw);
      }
    }
  }
}

function priceFromTick(tick: number, decimals0: number, decimals1: number): number | null {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, tick);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const scale = Math.pow(10, decimals0 - decimals1);
  const price = ratio * scale;
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function fetchGasPriceWei(): Promise<bigint | null> {
  const rpcUrl = env.RPC_URL_HTTP;
  if (!rpcUrl) return null;
  try {
    const client = makePublicClient(rpcUrl, env.ZEPHYR_ENV);
    return await client.getGasPrice();
  } catch {
    return null;
  }
}

function buildWatcherSnapshot(
  status: PoolWatcherStatusResult | null,
  health: EvmWatcherHealth | null,
  staleAfterMs: number,
): EvmState["watcher"] | undefined {
  if (!status && !health) return undefined;

  const live =
    health != null
      ? LIVE_WATCHER_STATES.has(health.state) && Boolean(health.wsConnected)
      : watcherStatusIsRecent(status, staleAfterMs);

  const lastUpdatedAt = pickWatcherLastUpdated(status, health);
  const stale = isWatcherStale(lastUpdatedAt, staleAfterMs);

  return {
    live,
    stale,
    state: health?.state,
    wsConnected: health?.wsConnected,
    lastSyncAt: health?.lastSyncAt ?? null,
    lastActivityAt: health?.lastActivityAt ?? null,
    startedAt: health?.startedAt ?? null,
    lastUpdatedAt,
    pid: health?.pid ?? null,
  };
}

function watcherStatusIsRecent(status: PoolWatcherStatusResult | null, maxAgeMs: number): boolean {
  if (!status?.updatedAt) return false;
  const updatedMs = parseTimestampMs(status.updatedAt);
  if (updatedMs == null) return false;
  return Date.now() - updatedMs <= maxAgeMs;
}

function pickWatcherLastUpdated(status: PoolWatcherStatusResult | null, health: EvmWatcherHealth | null): string | null {
  return health?.lastSyncAt ?? health?.lastActivityAt ?? status?.updatedAt ?? null;
}

function isWatcherStale(lastUpdatedIso: string | null, maxAgeMs: number): boolean {
  const updatedMs = parseTimestampMs(lastUpdatedIso);
  if (updatedMs == null) return false;
  return Date.now() - updatedMs > maxAgeMs;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldReplacePool(existing: EvmPool | undefined, candidate: EvmPool): boolean {
  if (!existing) return true;
  const existingHasPrice = existing.price != null && existing.priceInverse != null;
  const candidateHasPrice = candidate.price != null && candidate.priceInverse != null;
  if (!candidateHasPrice && existingHasPrice) return false;
  const existingTvl = typeof existing.tvlUsd === "number" && Number.isFinite(existing.tvlUsd) ? existing.tvlUsd : 0;
  const nextTvl = typeof candidate.tvlUsd === "number" && Number.isFinite(candidate.tvlUsd) ? candidate.tvlUsd : 0;
  if (existing.price == null && candidate.price != null) return true;
  if (existing.priceInverse == null && candidate.priceInverse != null) return true;
  if (nextTvl > existingTvl) return true;
  if ((existing.lastSwapAtMs ?? 0) < (candidate.lastSwapAtMs ?? 0)) return true;
  return false;
}
