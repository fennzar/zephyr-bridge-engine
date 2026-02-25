import { Prisma } from "@infra";

export const ONE_POINT_0001 = new Prisma.Decimal("1.0001");
export const Q96_DECIMAL = new Prisma.Decimal(2).pow(96);
export const DECIMAL_ONE = new Prisma.Decimal(1);
export const DECIMAL_EPSILON = new Prisma.Decimal("1e-18");
export const DEPTH_SAMPLE_TARGET_BPS = [10, 50, 100];

export function priceFromSqrtPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): { price: Prisma.Decimal; priceInverse: Prisma.Decimal } {
  const sqrtDecimal = new Prisma.Decimal(sqrtPriceX96.toString());
  const numerator = sqrtDecimal.pow(2);
  const denominator = Q96_DECIMAL.pow(2);
  let price = numerator.div(denominator);
  const decimalAdjustment = decimals0 - decimals1;
  if (decimalAdjustment !== 0) {
    const adjustment = new Prisma.Decimal(10).pow(decimalAdjustment);
    price = price.mul(adjustment);
  }
  const priceInverse =
    price.isZero() || !price.isFinite()
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(1).div(price);

  return { price, priceInverse };
}

export function computePositionAmountsDecimal(
  liquidity: Prisma.Decimal,
  sqrtLower: Prisma.Decimal,
  sqrtUpper: Prisma.Decimal,
  sqrtPrice: Prisma.Decimal,
): { amount0: Prisma.Decimal; amount1: Prisma.Decimal } {
  if (sqrtLower.gte(sqrtUpper)) {
    return { amount0: new Prisma.Decimal(0), amount1: new Prisma.Decimal(0) };
  }

  if (sqrtPrice.lte(sqrtLower)) {
    const numerator = sqrtUpper.minus(sqrtLower);
    const denominator = sqrtLower.mul(sqrtUpper);
    return {
      amount0: liquidity.mul(numerator).div(denominator),
      amount1: new Prisma.Decimal(0),
    };
  }

  if (sqrtPrice.gte(sqrtUpper)) {
    const numerator = sqrtUpper.minus(sqrtLower);
    return {
      amount0: new Prisma.Decimal(0),
      amount1: liquidity.mul(numerator),
    };
  }

  const amount0Numerator = sqrtUpper.minus(sqrtPrice);
  const amount0Denominator = sqrtPrice.mul(sqrtUpper);
  const amount1Numerator = sqrtPrice.minus(sqrtLower);

  return {
    amount0: liquidity.mul(amount0Numerator).div(amount0Denominator),
    amount1: liquidity.mul(amount1Numerator),
  };
}

export function sqrtRatioAtTick(tick: number): Prisma.Decimal {
  return ONE_POINT_0001.pow(tick).sqrt();
}

export function tickFromPrice(price: Prisma.Decimal): number {
  if (!price.isFinite() || price.lte(0)) return 0;
  const lnPrice = price.ln();
  const lnRatio = ONE_POINT_0001.ln();
  return Math.floor(lnPrice.div(lnRatio).toNumber());
}

export function computeActiveLiquidity(
  ticks: Array<{ tick: number; liquidityNet: Prisma.Decimal }>,
  currentTick: number,
): Prisma.Decimal {
  let liquidity = new Prisma.Decimal(0);
  for (const { tick, liquidityNet } of ticks) {
    if (tick > currentTick) break;
    liquidity = liquidity.plus(liquidityNet);
  }
  return liquidity;
}

export type DepthSimulationResult = {
  amountIn: Prisma.Decimal;
  amountOut: Prisma.Decimal;
  resultingTick: number;
};

export function simulateDepth(
  targetBps: number,
  sqrtPrice: Prisma.Decimal,
  currentTick: number,
  activeLiquidity: Prisma.Decimal,
  sortedTicks: Array<{ tick: number; liquidityNet: Prisma.Decimal }>,
  direction: "up" | "down",
): DepthSimulationResult | null {
  if (activeLiquidity.lte(0) || targetBps <= 0) return null;

  const ticksAscending = direction === "up" ? sortedTicks : [...sortedTicks].reverse();
  let idx: number;
  if (direction === "up") {
    const start = ticksAscending.findIndex(({ tick }) => tick > currentTick);
    idx = start >= 0 ? start : ticksAscending.length;
  } else {
    const start = ticksAscending.findIndex(({ tick }) => tick <= currentTick);
    idx = start >= 0 ? start : ticksAscending.length;
  }

  const sqrtMultiplier = DECIMAL_ONE.plus(new Prisma.Decimal(targetBps).div(10_000)).sqrt();
  let sqrtCursor = sqrtPrice;
  let liquidity = activeLiquidity;
  let tickCursor = currentTick;
  let amount0 = new Prisma.Decimal(0);
  let amount1 = new Prisma.Decimal(0);

  const goalSqrt = direction === "up" ? sqrtPrice.mul(sqrtMultiplier) : sqrtPrice.div(sqrtMultiplier);

  const iterateTicks = direction === "up"
    ? (tick: number) => tick > tickCursor
    : (tick: number) => tick < tickCursor;

  while (true) {
    const entry = ticksAscending[idx];
    const nextTick = entry?.tick;

    const sqrtBoundary = nextTick != null ? sqrtRatioAtTick(nextTick) : null;
    const targetReached = direction === "up"
      ? sqrtCursor.gte(goalSqrt.minus(DECIMAL_EPSILON))
      : sqrtCursor.lte(goalSqrt.plus(DECIMAL_EPSILON));
    if (targetReached) break;

    let sqrtStep: Prisma.Decimal;
    if (sqrtBoundary && nextTick !== undefined && iterateTicks(nextTick)) {
      const proceedToBoundary = direction === "up"
        ? sqrtBoundary.lte(goalSqrt)
        : sqrtBoundary.gte(goalSqrt);
      sqrtStep = proceedToBoundary ? sqrtBoundary : goalSqrt;
    } else {
      sqrtStep = goalSqrt;
    }

    if (sqrtStep.equals(sqrtCursor)) {
      break;
    }

    if (direction === "up") {
      const invStep = DECIMAL_ONE.div(sqrtStep);
      const invCurrent = DECIMAL_ONE.div(sqrtCursor);
      const delta0 = liquidity.mul(invStep.minus(invCurrent));
      const delta1 = liquidity.mul(sqrtStep.minus(sqrtCursor));
      amount0 = amount0.plus(delta0.abs());
      amount1 = amount1.plus(delta1.abs());
    } else {
      const delta0 = liquidity.mul(DECIMAL_ONE.div(sqrtCursor).minus(DECIMAL_ONE.div(sqrtStep)));
      const delta1 = liquidity.mul(sqrtCursor.minus(sqrtStep));
      amount0 = amount0.plus(delta0.abs());
      amount1 = amount1.plus(delta1.abs());
    }

    sqrtCursor = sqrtStep;

    if (sqrtBoundary && sqrtCursor.equals(sqrtBoundary)) {
      if (entry) {
        liquidity = liquidity.plus(entry.liquidityNet);
      }
      tickCursor = nextTick ?? tickCursor;
      idx += 1;
    } else {
      break;
    }
  }

  return {
    amountIn: amount0,
    amountOut: amount1,
    resultingTick: tickCursor,
  };
}

export function buildDepthSamples(
  sqrtPriceX96: bigint,
  currentTick: number,
  activeLiquidity: Prisma.Decimal,
  ticks: Array<{ tick: number; liquidityNet: Prisma.Decimal }>,
): Array<{ targetBps: number; amountIn: Prisma.Decimal; amountOut: Prisma.Decimal; resultingTick?: number }> {
  if (activeLiquidity.lte(0)) return [];
  const sqrtPriceDecimal = new Prisma.Decimal(sqrtPriceX96.toString()).div(Q96_DECIMAL);
  const samples: Array<{ targetBps: number; amountIn: Prisma.Decimal; amountOut: Prisma.Decimal; resultingTick?: number }> = [];

  for (const target of DEPTH_SAMPLE_TARGET_BPS) {
    const result = simulateDepth(target, sqrtPriceDecimal, currentTick, activeLiquidity, ticks, "up");
    if (!result) continue;
    if (result.amountIn.lte(0) || result.amountOut.lte(0)) continue;

    samples.push({
      targetBps: target,
      amountIn: result.amountIn,
      amountOut: result.amountOut,
      resultingTick: result.resultingTick,
    });
  }

  return samples;
}
