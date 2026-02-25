/**
 * Pure bigint math for Uniswap V4 concentrated liquidity calculations.
 * No Prisma/Decimal dependency — intended for engine execution paths.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const Q96 = 2n ** 96n;
export const Q192 = 2n ** 192n;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO =
  1461446703485210103287273052203988822378723970342n;

// ── Tick ↔ sqrtPriceX96 ─────────────────────────────────────────────────────

/**
 * Compute sqrtPriceX96 from a tick index.
 * Formula: sqrt(1.0001^tick) * 2^96
 */
export function getSqrtPriceAtTick(tick: number): bigint {
  const absTick = Math.abs(tick);
  if (absTick > 887272) {
    throw new RangeError(`Tick ${tick} out of range (max abs 887272)`);
  }

  // Use floating-point for the computation, then scale to Q96.
  // 1.0001^tick = exp(tick * ln(1.0001))
  // sqrtPrice = 1.0001^(tick/2)
  const sqrtPrice = Math.pow(1.0001, tick / 2);

  // Scale to Q96 bigint. We use string conversion to avoid float→bigint
  // precision issues at the boundary.
  const q96Float = Number(Q96);
  const scaled = sqrtPrice * q96Float;

  // BigInt() truncates toward zero which is fine here.
  const result = BigInt(Math.round(scaled));

  if (result < MIN_SQRT_RATIO) return MIN_SQRT_RATIO;
  if (result > MAX_SQRT_RATIO) return MAX_SQRT_RATIO;
  return result;
}

/**
 * Compute the tick index for a given sqrtPriceX96 (floored).
 * Inverse of getSqrtPriceAtTick.
 */
export function getTickAtSqrtPrice(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
    throw new RangeError(
      `sqrtPriceX96 out of range [MIN_SQRT_RATIO, MAX_SQRT_RATIO]`,
    );
  }

  // sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
  // sqrtPrice = sqrtPriceX96 / 2^96
  // sqrtPrice^2 = 1.0001^tick
  // tick = log(sqrtPrice^2) / log(1.0001)
  //      = 2 * log(sqrtPrice) / log(1.0001)
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const MAX_TICK = 887272;
  const tick = Math.max(-MAX_TICK, Math.min(MAX_TICK, Math.floor(
    (2 * Math.log(sqrtPrice)) / Math.log(1.0001),
  )));

  // Verify and adjust: the computed tick's sqrtPrice must be <= the input.
  // Due to floating-point rounding we may be off by 1.
  if (tick < MAX_TICK) {
    const checkUpper = getSqrtPriceAtTick(tick + 1);
    if (checkUpper <= sqrtPriceX96) return tick + 1;
  }

  return tick;
}

// ── Tick snapping ────────────────────────────────────────────────────────────

/** Round tick down to the nearest multiple of spacing. */
export function floorTick(tick: number, spacing: number): number {
  // For negative ticks, Math.floor(-1 / 10) = -1 which gives -10, correct.
  return Math.floor(tick / spacing) * spacing;
}

/** Round tick up to the nearest multiple of spacing. */
export function ceilTick(tick: number, spacing: number): number {
  // The `|| 0` coerces -0 to +0 (Math.ceil returns -0 for inputs in (-1, 0)).
  return Math.ceil(tick / spacing) * spacing || 0;
}

// ── Human-readable price → sqrtPriceX96 ─────────────────────────────────────

/**
 * Convert a human-readable price to sqrtPriceX96.
 *
 * price = amount1 / amount0 in human terms
 * priceAdjusted = price * 10^(decimals1 - decimals0)  (raw / raw ratio)
 * sqrtPriceX96 = sqrt(priceAdjusted) * 2^96
 */
export function priceToSqrtPriceX96(
  price: number,
  decimals0: number,
  decimals1: number,
): bigint {
  if (price <= 0) throw new RangeError("Price must be positive");

  const adjusted = price * Math.pow(10, decimals1 - decimals0);
  const sqrtAdj = Math.sqrt(adjusted);
  const q96Float = Number(Q96);
  const result = BigInt(Math.round(sqrtAdj * q96Float));

  if (result < MIN_SQRT_RATIO) return MIN_SQRT_RATIO;
  if (result > MAX_SQRT_RATIO) return MAX_SQRT_RATIO;
  return result;
}

// ── Tick bounds from price + band ────────────────────────────────────────────

/**
 * Compute tick bounds for a concentrated liquidity position.
 *
 * Given a center price and band width in bps, compute lower and upper ticks
 * snapped to the given tick spacing.
 */
export function computeTickBounds(
  price: number,
  bandBps: number,
  tickSpacing: number,
  decimals0: number = 0,
  decimals1: number = 0,
): { tickLower: number; tickUpper: number } {
  if (price <= 0) throw new RangeError("Price must be positive");
  if (bandBps <= 0) throw new RangeError("bandBps must be positive");
  if (tickSpacing <= 0) throw new RangeError("tickSpacing must be positive");

  const lowerPrice = price * (1 - bandBps / 10_000);
  const upperPrice = price * (1 + bandBps / 10_000);

  const sqrtLower = priceToSqrtPriceX96(Math.max(lowerPrice, 1e-18), decimals0, decimals1);
  const sqrtUpper = priceToSqrtPriceX96(upperPrice, decimals0, decimals1);

  let tickLower = floorTick(getTickAtSqrtPrice(sqrtLower), tickSpacing);
  let tickUpper = ceilTick(getTickAtSqrtPrice(sqrtUpper), tickSpacing);

  // Guarantee tickLower < tickUpper
  if (tickLower >= tickUpper) {
    tickUpper = tickLower + tickSpacing;
  }

  return { tickLower, tickUpper };
}

// ── Core V4 liquidity formulas ───────────────────────────────────────────────

/**
 * Compute the maximum liquidity that can be provided given token amounts
 * and a price range. Equivalent to Uniswap's LiquidityAmounts.getLiquidityForAmounts.
 */
export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  if (sqrtLower >= sqrtUpper) {
    throw new RangeError("sqrtLower must be < sqrtUpper");
  }

  if (sqrtPriceX96 <= sqrtLower) {
    // Current price is below range — position is entirely token0.
    // L = amount0 * sqrtLower * sqrtUpper / ((sqrtUpper - sqrtLower) * Q96)
    return (
      (amount0 * sqrtLower * sqrtUpper) /
      ((sqrtUpper - sqrtLower) * Q96)
    );
  }

  if (sqrtPriceX96 >= sqrtUpper) {
    // Current price is above range — position is entirely token1.
    // L = amount1 * Q96 / (sqrtUpper - sqrtLower)
    return (amount1 * Q96) / (sqrtUpper - sqrtLower);
  }

  // Current price is within range — use the min of both formulas.
  const L0 =
    (amount0 * sqrtPriceX96 * sqrtUpper) /
    ((sqrtUpper - sqrtPriceX96) * Q96);
  const L1 = (amount1 * Q96) / (sqrtPriceX96 - sqrtLower);
  return L0 < L1 ? L0 : L1;
}

/**
 * Compute token amounts for a given liquidity and price range.
 * Inverse of getLiquidityForAmounts.
 */
export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtLower: bigint,
  sqrtUpper: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  if (sqrtLower >= sqrtUpper) {
    throw new RangeError("sqrtLower must be < sqrtUpper");
  }

  if (sqrtPriceX96 <= sqrtLower) {
    // Entirely token0.
    // amount0 = L * Q96 * (sqrtUpper - sqrtLower) / (sqrtUpper * sqrtLower)
    const amount0 =
      (liquidity * Q96 * (sqrtUpper - sqrtLower)) /
      (sqrtUpper * sqrtLower);
    return { amount0, amount1: 0n };
  }

  if (sqrtPriceX96 >= sqrtUpper) {
    // Entirely token1.
    // amount1 = L * (sqrtUpper - sqrtLower) / Q96
    const amount1 =
      (liquidity * (sqrtUpper - sqrtLower)) / Q96;
    return { amount0: 0n, amount1 };
  }

  // Within range — both tokens.
  const amount0 =
    (liquidity * Q96 * (sqrtUpper - sqrtPriceX96)) /
    (sqrtUpper * sqrtPriceX96);
  const amount1 =
    (liquidity * (sqrtPriceX96 - sqrtLower)) / Q96;

  return { amount0, amount1 };
}
