import { Prisma, type prisma } from "@infra";

import {
  computePositionAmountsDecimal,
  tickFromPrice,
  computeActiveLiquidity,
  buildDepthSamples,
  ONE_POINT_0001,
} from "./persistence.math";

/** Input parameters for pool metrics computation. */
export interface RecomputePoolMetricsParams {
  poolId: string;
  sqrtPrice: Prisma.Decimal;
  sqrtPriceX96: bigint;
  token0Decimals: number;
  token1Decimals: number;
  priceToken1PerToken0: Prisma.Decimal;
}

/** Result of pool metrics computation. */
export interface PoolMetricsResult {
  totalToken0: Prisma.Decimal;
  totalToken1: Prisma.Decimal;
  tvlToken1: Prisma.Decimal;
  liquidity: Prisma.Decimal;
  currentTick: number;
  ticks: Array<{ tick: number; liquidityNet: Prisma.Decimal }>;
  depthSamples: Array<{ targetBps: number; amountIn: Prisma.Decimal; amountOut: Prisma.Decimal; resultingTick?: number }>;
  sqrtPriceX96: string;
}

/**
 * Recompute pool-level metrics (TVL, active liquidity, depth samples)
 * by aggregating all positions belonging to the given pool.
 */
export async function recomputePoolMetrics(
  db: typeof prisma,
  params: RecomputePoolMetricsParams,
): Promise<PoolMetricsResult> {
  const positions = await db.position.findMany({
    where: { poolId: params.poolId },
    select: {
      liquidity: true,
      tickLower: true,
      tickUpper: true,
    },
  });

  let totalToken0 = new Prisma.Decimal(0);
  let totalToken1 = new Prisma.Decimal(0);
  const decimalsFactor0 = new Prisma.Decimal(10).pow(params.token0Decimals);
  const decimalsFactor1 = new Prisma.Decimal(10).pow(params.token1Decimals);

  const liquidityNetByTick = new Map<number, Prisma.Decimal>();

  for (const position of positions) {
    const liquidityValue = position.liquidity
      ? new Prisma.Decimal(position.liquidity.toString())
      : new Prisma.Decimal(0);
    if (liquidityValue.isZero()) continue;

    const sqrtLower = ONE_POINT_0001.pow(position.tickLower).sqrt();
    const sqrtUpper = ONE_POINT_0001.pow(position.tickUpper).sqrt();

    const { amount0, amount1 } = computePositionAmountsDecimal(
      liquidityValue,
      sqrtLower,
      sqrtUpper,
      params.sqrtPrice,
    );

    totalToken0 = totalToken0.plus(amount0.div(decimalsFactor0));
    totalToken1 = totalToken1.plus(amount1.div(decimalsFactor1));

   const lowerDelta = liquidityNetByTick.get(position.tickLower) ?? new Prisma.Decimal(0);
    liquidityNetByTick.set(position.tickLower, lowerDelta.plus(liquidityValue));
    const upperDelta = liquidityNetByTick.get(position.tickUpper) ?? new Prisma.Decimal(0);
    liquidityNetByTick.set(position.tickUpper, upperDelta.minus(liquidityValue));
  }

  const tvlToken1 = totalToken1.plus(totalToken0.mul(params.priceToken1PerToken0));

  const sortedTicks = Array.from(liquidityNetByTick.entries())
    .map(([tick, liquidityNet]) => ({ tick, liquidityNet }))
    .sort((a, b) => a.tick - b.tick);

  const currentTick = tickFromPrice(params.priceToken1PerToken0);
  const activeLiquidity = computeActiveLiquidity(sortedTicks, currentTick);
  const depthSamples = buildDepthSamples(
    params.sqrtPriceX96,
    currentTick,
    activeLiquidity,
    sortedTicks,
  );

  return {
    totalToken0,
    totalToken1,
    tvlToken1,
    liquidity: activeLiquidity,
    currentTick,
    ticks: sortedTicks,
    depthSamples,
    sqrtPriceX96: params.sqrtPriceX96.toString(),
  };
}
