import type { Address, PublicClient } from "viem";
import { getAddress } from "viem";
import {
  PoolProtocol,
  prisma,
  type Pool as DbPool,
  type Position as DbPosition,
  type Token as DbToken,
} from "@infra";
import type { NetworkEnv } from "@shared";

import { getNetworkConfig } from "./config";

export type PoolDepthSample = {
  targetBps: number;
  amountIn: string;
  amountOut: string;
  resultingTick?: number;
};

export type PoolTickSnapshot = {
  tick: number;
  liquidityNet: string;
};

type PoolToken = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type PoolOverview = {
  id: string;
  base: PoolToken;
  quote: PoolToken;
  feeBps: number;
  tickSpacing?: number;
  volume24hUsd: number;
  aprBps: number;
  activePositions: number;
  lastPrice?: number;
  lastPriceInverse?: number;
  lastTick?: number;
  lastSwapAt?: string;
  totalToken0?: number;
  totalToken1?: number;
  totalToken0Usd?: number;
  totalToken1Usd?: number;
  tvlUsd: number;
  quoteSymbol?: string | null;
  currentTick?: number | null;
  sqrtPriceX96?: string | null;
  liquidity?: string | null;
  ticks?: PoolTickSnapshot[];
  depthSamples?: PoolDepthSample[];
};

export type PositionOverview = {
  id: string;
  poolId: string;
  owner: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0?: string;
  amount1?: string;
  owed0?: string;
  owed1?: string;
  updatedAt?: string;
  token0: PoolToken;
  token1: PoolToken;
  notionalUsd: number;
  isInRange: boolean;
  feesUsd: number;
};

export type PoolDiscoveryLog = {
  id: string;
  poolId: string | null;
  poolAddress: string | null;
  token0: PoolToken | null;
  token1: PoolToken | null;
  feeTierBps: number | null;
  blockNumber: number;
  blockTimestamp: string;
  txHash: string;
  factoryAddress: string | null;
  discoveredAt: string;
};

export type PoolWatcherStatus = {
  cursorKey: string;
  network: NetworkEnv;
  chainId: number | null;
  lastBlock: number | null;
  lastTimestamp: string | null;
  updatedAt: string;
};

export type PoolDiscoverySummary = {
  poolCount: number;
  tokenCount: number;
  discoveryEventCount: number;
  latestEvent: PoolDiscoveryLog | null;
  totalTvlUsd: number;
};

function resolveEnv(): NetworkEnv {
  const raw = process.env.ZEPHYR_ENV?.toLowerCase();
  if (raw === "sepolia" || raw === "mainnet") return raw;
  return "local";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function metadataToRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function mapDbTokenSafe(token: DbToken): PoolToken {
  return {
    address: getAddress(token.address),
    symbol: token.symbol ?? token.address,
    decimals: token.decimals,
  };
}

function parseTicks(meta: Record<string, unknown>): PoolTickSnapshot[] | undefined {
  const ticks = meta.poolTicks;
  if (!Array.isArray(ticks)) return undefined;
  const result: PoolTickSnapshot[] = [];
  for (const entry of ticks) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const tick = typeof rec.tick === "number" ? rec.tick : undefined;
    const liquidityNet = typeof rec.liquidityNet === "string" ? rec.liquidityNet : undefined;
    if (tick == null || liquidityNet == null) continue;
    result.push({ tick, liquidityNet });
  }
  return result.length > 0 ? result : undefined;
}

function parseDepth(meta: Record<string, unknown>): PoolDepthSample[] | undefined {
  const samples = meta.depthSamples;
  if (!Array.isArray(samples)) return undefined;
  const result: PoolDepthSample[] = [];
  for (const entry of samples) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const targetBps = typeof rec.targetBps === "number" ? rec.targetBps : undefined;
    const amountIn = typeof rec.amountIn === "string" ? rec.amountIn : undefined;
    const amountOut = typeof rec.amountOut === "string" ? rec.amountOut : undefined;
    const resultingTick = typeof rec.resultingTick === "number" ? rec.resultingTick : undefined;
    if (targetBps == null || amountIn == null || amountOut == null) continue;
    result.push({ targetBps, amountIn, amountOut, resultingTick });
  }
  return result.length > 0 ? result : undefined;
}

function mapDbPoolToOverview(pool: DbPoolWithTokens, activePositions: number): PoolOverview {
  const meta = metadataToRecord(pool.metadata);
  const price = readNumber(meta.lastPrice);
  const priceInverse = readNumber(meta.lastPriceInverse);
  const totalToken0 = readNumber(meta.totalToken0);
  const totalToken1 = readNumber(meta.totalToken1);
  const totalToken0Usd = readNumber(meta.totalToken0Usd);
  const totalToken1Usd = readNumber(meta.totalToken1Usd);
  const currentTick = readNumber(meta.currentTick) ?? readNumber(meta.lastTick) ?? null;

  return {
    id: pool.address,
    base: mapDbTokenSafe(pool.token0),
    quote: mapDbTokenSafe(pool.token1),
    feeBps: pool.feeTierBps ?? 0,
    tickSpacing: pool.tickSpacing ?? undefined,
    volume24hUsd: readNumber(meta.volume24hUsd) ?? 0,
    aprBps: Math.round(readNumber(meta.aprBps) ?? 0),
    activePositions,
    lastPrice: price,
    lastPriceInverse: priceInverse,
    lastTick: readNumber(meta.lastTick),
    lastSwapAt: typeof meta.lastSwapAt === "string" ? meta.lastSwapAt : undefined,
    totalToken0,
    totalToken1,
    totalToken0Usd,
    totalToken1Usd,
    tvlUsd: readNumber(meta.tvlUsd) ?? Number.NaN,
    quoteSymbol: pool.token1.symbol ?? null,
    currentTick,
    sqrtPriceX96: typeof meta.lastSqrtPriceX96 === "string" ? meta.lastSqrtPriceX96 : null,
    liquidity: typeof meta.lastLiquidity === "string" ? meta.lastLiquidity : null,
    ticks: parseTicks(meta),
    depthSamples: parseDepth(meta),
  } satisfies PoolOverview;
}

function mapDbPositionToOverview(position: DbPositionWithPool): PositionOverview {
  const meta = metadataToRecord(position.metadata);
  return {
    id: position.id,
    poolId: position.pool.address,
    owner: getAddress(position.owner) as Address,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    liquidity: position.liquidity?.toString() ?? "0",
    amount0: position.amount0?.toString() ?? undefined,
    amount1: position.amount1?.toString() ?? undefined,
    owed0: position.fees0?.toString() ?? undefined,
    owed1: position.fees1?.toString() ?? undefined,
    updatedAt: position.lastUpdatedAt?.toISOString(),
    token0: mapDbTokenSafe(position.pool.token0),
    token1: mapDbTokenSafe(position.pool.token1),
    notionalUsd: readNumber(meta.notionalUsd) ?? 0,
    isInRange: position.liquidity ? !position.liquidity.isZero() : false,
    feesUsd: readNumber(meta.feesUsd) ?? 0,
  } satisfies PositionOverview;
}

export async function getPools(): Promise<PoolOverview[]> {
  const env = resolveEnv();
  const { chainId } = getNetworkConfig(env);

  const dbPools = await prisma.pool.findMany({
    where: {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
    },
    include: {
      token0: true,
      token1: true,
    },
    orderBy: {
      discoveredAt: "desc",
    },
  });

  if (dbPools.length === 0) {
    return [];
  }

  const positionCounts = await prisma.position.groupBy({
    by: ["poolId"],
    where: {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
    },
    _count: { poolId: true },
  });

  const countMap = new Map<string, number>(positionCounts.map((row) => [row.poolId, row._count.poolId]));

  return (dbPools as DbPoolWithTokens[]).map((pool) =>
    mapDbPoolToOverview(pool, countMap.get(pool.id) ?? 0),
  );
}

export async function getPositions(_client: PublicClient | null, owner: Address): Promise<PositionOverview[]> {
  const env = resolveEnv();
  const { chainId } = getNetworkConfig(env);
  const ownerKey = owner.toLowerCase();

  const dbPositions = await prisma.position.findMany({
    where: {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
      owner: ownerKey,
    },
    include: {
      pool: {
        include: {
          token0: true,
          token1: true,
        },
      },
    },
    orderBy: {
      lastUpdatedAt: "desc",
    },
  });

  if (dbPositions.length === 0) {
    return [];
  }

  return (dbPositions as DbPositionWithPool[]).map(mapDbPositionToOverview);
}

export async function getRecentPoolDiscoveryEvents(limit = 20, networkEnv?: NetworkEnv): Promise<PoolDiscoveryLog[]> {
  const env = networkEnv ?? resolveEnv();
  const { chainId } = getNetworkConfig(env);

  const events = await prisma.poolDiscoveryEvent.findMany({
    where: {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
    },
    include: {
      pool: {
        include: {
          token0: true,
          token1: true,
        },
      },
    },
    orderBy: {
      blockNumber: "desc",
    },
    take: limit,
  });

  return events.map((event) => {
    const pool = event.pool;
    return {
      id: event.id,
      poolId: pool?.id ?? null,
      poolAddress: pool?.address ?? null,
      token0: pool ? mapDbTokenSafe(pool.token0) : null,
      token1: pool ? mapDbTokenSafe(pool.token1) : null,
      feeTierBps: pool?.feeTierBps ?? null,
      blockNumber: Number(event.blockNumber ?? 0n),
      blockTimestamp: event.blockTimestamp.toISOString(),
      txHash: event.txHash,
      factoryAddress: event.factoryAddress ?? null,
      discoveredAt: event.createdAt.toISOString(),
    } satisfies PoolDiscoveryLog;
  });
}

export async function getPoolWatcherStatus(networkEnv?: NetworkEnv): Promise<PoolWatcherStatus | null> {
  const env = networkEnv ?? resolveEnv();
  const { chainId } = getNetworkConfig(env);
  const cursorKey = `${env}:uniswap_v4_pool_manager`;

  const cursor = await prisma.scanCursor.findUnique({
    where: { cursorKey },
  });

  if (!cursor) return null;

  return {
    cursorKey,
    network: env,
    chainId: cursor.chainId ?? chainId ?? null,
    lastBlock: cursor.lastBlock ? Number(cursor.lastBlock) : null,
    lastTimestamp: cursor.lastTimestamp ? cursor.lastTimestamp.toISOString() : null,
    updatedAt: cursor.updatedAt.toISOString(),
  } satisfies PoolWatcherStatus;
}

export async function getPoolDiscoverySummary(networkEnv?: NetworkEnv): Promise<PoolDiscoverySummary> {
  const env = networkEnv ?? resolveEnv();
  const { chainId } = getNetworkConfig(env);

  const [poolCount, tokenCount, discoveryEventCount, latestEvent] = await Promise.all([
    prisma.pool.count({
      where: {
        chainId,
        protocol: PoolProtocol.UNISWAP_V4,
      },
    }),
    prisma.token.count({
      where: {
        chainId,
      },
    }),
    prisma.poolDiscoveryEvent.count({
      where: {
        chainId,
        protocol: PoolProtocol.UNISWAP_V4,
      },
    }),
    prisma.poolDiscoveryEvent.findFirst({
      where: {
        chainId,
        protocol: PoolProtocol.UNISWAP_V4,
      },
      include: {
        pool: {
          include: {
            token0: true,
            token1: true,
          },
        },
      },
      orderBy: [
        { blockNumber: "desc" },
        { logIndex: "desc" },
      ],
    }),
  ]);

  let latest: PoolDiscoveryLog | null = null;
  if (latestEvent) {
    const pool = latestEvent.pool;
    latest = {
      id: latestEvent.id,
      poolId: pool?.id ?? null,
      poolAddress: pool?.address ?? null,
      token0: pool ? mapDbTokenSafe(pool.token0) : null,
      token1: pool ? mapDbTokenSafe(pool.token1) : null,
      feeTierBps: pool?.feeTierBps ?? null,
      blockNumber: Number(latestEvent.blockNumber ?? 0n),
      blockTimestamp: latestEvent.blockTimestamp.toISOString(),
      txHash: latestEvent.txHash,
      factoryAddress: latestEvent.factoryAddress ?? null,
      discoveredAt: latestEvent.createdAt.toISOString(),
    };
  }

  const pools = await prisma.pool.findMany({
    where: {
      chainId,
      protocol: PoolProtocol.UNISWAP_V4,
    },
    include: {
      token0: true,
      token1: true,
    },
  });

  let totalTvlUsdAccum = 0;
  let hasComputedTvl = false;
  for (const pool of pools as DbPoolWithTokens[]) {
    const meta = metadataToRecord(pool.metadata);
    const totalToken0Usd = readNumber(meta.totalToken0Usd);
    const totalToken1Usd = readNumber(meta.totalToken1Usd);
    if (totalToken0Usd != null && totalToken1Usd != null) {
      hasComputedTvl = true;
      totalTvlUsdAccum += totalToken0Usd + totalToken1Usd;
    }
  }

  return {
    poolCount,
    tokenCount,
    discoveryEventCount,
    latestEvent: latest,
    totalTvlUsd: hasComputedTvl ? totalTvlUsdAccum : Number.NaN,
  };
}

type DbPoolWithTokens = DbPool & { token0: DbToken; token1: DbToken };
type DbPositionWithPool = DbPosition & { pool: DbPoolWithTokens };
