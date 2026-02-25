import { describe, expect, it } from "vitest";

import {
  Q96,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  getSqrtPriceAtTick,
  getTickAtSqrtPrice,
  floorTick,
  ceilTick,
  priceToSqrtPriceX96,
  computeTickBounds,
  getLiquidityForAmounts,
  getAmountsForLiquidity,
} from "@services/evm/uniswapV4/liquidityMath";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute difference between two bigints. */
function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

/** Check that `actual` is within `tolerance` of `expected` (bigint). */
function expectCloseBigInt(actual: bigint, expected: bigint, tolerance: bigint) {
  const diff = absDiff(actual, expected);
  expect(diff <= tolerance).toBe(true);
}

// ---------------------------------------------------------------------------
// getSqrtPriceAtTick / getTickAtSqrtPrice
// ---------------------------------------------------------------------------

describe("getSqrtPriceAtTick / getTickAtSqrtPrice", () => {
  it("tick 0 produces sqrtPriceX96 equal to Q96 (price = 1.0)", () => {
    const sqrtPrice = getSqrtPriceAtTick(0);
    expect(sqrtPrice).toBe(Q96);
  });

  it("positive tick 1000 produces sqrtPrice > Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(1000);
    expect(sqrtPrice).toBeGreaterThan(Q96);
  });

  it("positive tick 10000 produces sqrtPrice > Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(10000);
    expect(sqrtPrice).toBeGreaterThan(Q96);
  });

  it("positive tick 50000 produces sqrtPrice > Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(50000);
    expect(sqrtPrice).toBeGreaterThan(Q96);
  });

  it("negative tick -1000 produces sqrtPrice < Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(-1000);
    expect(sqrtPrice).toBeLessThan(Q96);
    expect(sqrtPrice).toBeGreaterThan(0n);
  });

  it("negative tick -10000 produces sqrtPrice < Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(-10000);
    expect(sqrtPrice).toBeLessThan(Q96);
    expect(sqrtPrice).toBeGreaterThan(0n);
  });

  it("negative tick -50000 produces sqrtPrice < Q96", () => {
    const sqrtPrice = getSqrtPriceAtTick(-50000);
    expect(sqrtPrice).toBeLessThan(Q96);
    expect(sqrtPrice).toBeGreaterThan(0n);
  });

  it("higher ticks produce higher sqrtPrices (monotonic)", () => {
    const s1 = getSqrtPriceAtTick(1000);
    const s2 = getSqrtPriceAtTick(10000);
    const s3 = getSqrtPriceAtTick(50000);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  describe("round-trip: getTickAtSqrtPrice(getSqrtPriceAtTick(tick))", () => {
    const ticks = [0, 1, -1, 100, -100, 1000, -1000, 10000, -10000, 50000, -50000];

    for (const tick of ticks) {
      it(`tick ${tick} round-trips within +/- 1`, () => {
        const sqrtPrice = getSqrtPriceAtTick(tick);
        const recovered = getTickAtSqrtPrice(sqrtPrice);
        expect(Math.abs(recovered - tick)).toBeLessThanOrEqual(1);
      });
    }
  });

  it("throws for tick above 887272", () => {
    expect(() => getSqrtPriceAtTick(887273)).toThrow(RangeError);
  });

  it("throws for tick below -887272", () => {
    expect(() => getSqrtPriceAtTick(-887273)).toThrow(RangeError);
  });

  it("getTickAtSqrtPrice throws for sqrtPriceX96 below MIN_SQRT_RATIO", () => {
    expect(() => getTickAtSqrtPrice(MIN_SQRT_RATIO - 1n)).toThrow(RangeError);
  });

  it("getTickAtSqrtPrice throws for sqrtPriceX96 above MAX_SQRT_RATIO", () => {
    expect(() => getTickAtSqrtPrice(MAX_SQRT_RATIO + 1n)).toThrow(RangeError);
  });

  it("getTickAtSqrtPrice accepts MIN_SQRT_RATIO without throwing", () => {
    expect(() => getTickAtSqrtPrice(MIN_SQRT_RATIO)).not.toThrow();
  });

  it("getTickAtSqrtPrice accepts MAX_SQRT_RATIO without throwing", () => {
    expect(() => getTickAtSqrtPrice(MAX_SQRT_RATIO)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// floorTick / ceilTick
// ---------------------------------------------------------------------------

describe("floorTick", () => {
  it("floors positive tick to spacing 60", () => {
    expect(floorTick(59, 60)).toBe(0);
    expect(floorTick(61, 60)).toBe(60);
    expect(floorTick(119, 60)).toBe(60);
  });

  it("floors negative tick to spacing 60", () => {
    expect(floorTick(-1, 60)).toBe(-60);
    expect(floorTick(-59, 60)).toBe(-60);
    expect(floorTick(-61, 60)).toBe(-120);
  });

  it("tick already on spacing boundary is unchanged", () => {
    expect(floorTick(0, 60)).toBe(0);
    expect(floorTick(60, 60)).toBe(60);
    expect(floorTick(-60, 60)).toBe(-60);
    expect(floorTick(120, 60)).toBe(120);
    expect(floorTick(-120, 60)).toBe(-120);
  });

  it("works with spacing 10", () => {
    expect(floorTick(15, 10)).toBe(10);
    expect(floorTick(-15, 10)).toBe(-20);
  });
});

describe("ceilTick", () => {
  it("ceils positive tick to spacing 60", () => {
    expect(ceilTick(1, 60)).toBe(60);
    expect(ceilTick(59, 60)).toBe(60);
    expect(ceilTick(61, 60)).toBe(120);
  });

  it("ceils negative tick to spacing 60", () => {
    expect(ceilTick(-1, 60)).toBe(0);
    expect(ceilTick(-59, 60)).toBe(0);
    expect(ceilTick(-61, 60)).toBe(-60);
  });

  it("tick already on spacing boundary is unchanged", () => {
    expect(ceilTick(0, 60)).toBe(0);
    expect(ceilTick(60, 60)).toBe(60);
    expect(ceilTick(-60, 60)).toBe(-60);
    expect(ceilTick(120, 60)).toBe(120);
    expect(ceilTick(-120, 60)).toBe(-120);
  });

  it("works with spacing 10", () => {
    expect(ceilTick(5, 10)).toBe(10);
    expect(ceilTick(-5, 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// priceToSqrtPriceX96
// ---------------------------------------------------------------------------

describe("priceToSqrtPriceX96", () => {
  it("price=1.0 with equal decimals produces value close to Q96", () => {
    const result = priceToSqrtPriceX96(1.0, 18, 18);
    // Should be exactly Q96 or very close (within floating-point rounding)
    expectCloseBigInt(result, Q96, 1n);
  });

  it("price=1.0 with decimals0=12, decimals1=6 accounts for decimal difference", () => {
    // adjusted = 1.0 * 10^(12-6) = 1e6
    // sqrtPriceX96 = sqrt(1e6) * 2^96 = 1000 * Q96
    const result = priceToSqrtPriceX96(1.0, 12, 6);
    const expected = Q96 * 1000n;
    // Allow some floating-point rounding tolerance
    expectCloseBigInt(result, expected, Q96 / 1000n);
  });

  it("price=1.0 with decimals0=6, decimals1=12 accounts for decimal difference", () => {
    // adjusted = 1.0 * 10^(6-12) = 1e-6
    // sqrtPriceX96 = sqrt(1e-6) * 2^96 = 0.001 * Q96
    const result = priceToSqrtPriceX96(1.0, 6, 12);
    const expected = Q96 / 1000n;
    expectCloseBigInt(result, expected, Q96 / 100000n);
  });

  it("price=0.58 with equal decimals (ZEPH price scenario)", () => {
    const result = priceToSqrtPriceX96(0.58, 12, 12);
    // sqrt(0.58) ~ 0.7616
    // expected ~ 0.7616 * Q96
    const expectedApprox = BigInt(Math.round(Math.sqrt(0.58) * Number(Q96)));
    expectCloseBigInt(result, expectedApprox, 1n);
  });

  it("price=100.0 with equal decimals", () => {
    const result = priceToSqrtPriceX96(100.0, 18, 18);
    // sqrt(100) = 10, so expected = 10 * Q96
    const expected = Q96 * 10n;
    expectCloseBigInt(result, expected, 2n);
  });

  it("throws for zero price", () => {
    expect(() => priceToSqrtPriceX96(0, 18, 18)).toThrow(RangeError);
  });

  it("throws for negative price", () => {
    expect(() => priceToSqrtPriceX96(-1.5, 18, 18)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// computeTickBounds
// ---------------------------------------------------------------------------

describe("computeTickBounds", () => {
  it("price=1.0, bandBps=50, tickSpacing=10 gives symmetric bounds", () => {
    const { tickLower, tickUpper } = computeTickBounds(1.0, 50, 10);

    expect(tickLower).toBeLessThan(0);
    expect(tickUpper).toBeGreaterThan(0);
    // Use === 0 instead of toBe(0) because JS modulo preserves sign (-0 !== 0 under Object.is)
    expect(tickLower % 10 === 0).toBe(true);
    expect(tickUpper % 10 === 0).toBe(true);
    expect(tickLower).toBeLessThan(tickUpper);
  });

  it("price=0.58, bandBps=100, tickSpacing=60 gives valid bounds", () => {
    const { tickLower, tickUpper } = computeTickBounds(0.58, 100, 60);

    // Both must be multiples of 60 (use === to avoid -0 vs 0 issue with Object.is)
    expect(tickLower % 60 === 0).toBe(true);
    expect(tickUpper % 60 === 0).toBe(true);
    expect(tickLower).toBeLessThan(tickUpper);

    // Both should be negative since price < 1.0 (tick for price 0.58 is negative)
    expect(tickLower).toBeLessThan(0);
  });

  it("tickLower is always strictly less than tickUpper", () => {
    const prices = [0.01, 0.5, 1.0, 2.0, 100.0];
    const bandValues = [10, 50, 100, 500];
    const spacings = [1, 10, 60, 200];

    for (const price of prices) {
      for (const band of bandValues) {
        for (const spacing of spacings) {
          const { tickLower, tickUpper } = computeTickBounds(price, band, spacing);
          expect(tickLower).toBeLessThan(tickUpper);
        }
      }
    }
  });

  it("both bounds are multiples of tickSpacing", () => {
    const { tickLower, tickUpper } = computeTickBounds(1.5, 200, 60);
    expect(tickLower % 60 === 0).toBe(true);
    expect(tickUpper % 60 === 0).toBe(true);
  });

  it("throws for zero price", () => {
    expect(() => computeTickBounds(0, 50, 10)).toThrow(RangeError);
  });

  it("throws for negative price", () => {
    expect(() => computeTickBounds(-1, 50, 10)).toThrow(RangeError);
  });

  it("throws for zero bandBps", () => {
    expect(() => computeTickBounds(1.0, 0, 10)).toThrow(RangeError);
  });

  it("throws for zero tickSpacing", () => {
    expect(() => computeTickBounds(1.0, 50, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// getLiquidityForAmounts
// ---------------------------------------------------------------------------

describe("getLiquidityForAmounts", () => {
  // Set up a standard range around tick 0 for testing.
  const sqrtLower = getSqrtPriceAtTick(-1000);
  const sqrtUpper = getSqrtPriceAtTick(1000);
  const amount0 = 1_000_000_000_000n; // 1.0 in 12-decimal token
  const amount1 = 1_000_000_000_000n;

  it("price below range: position is entirely token0", () => {
    const sqrtPriceBelowRange = getSqrtPriceAtTick(-2000);
    const liquidity = getLiquidityForAmounts(
      sqrtPriceBelowRange,
      sqrtLower,
      sqrtUpper,
      amount0,
      amount1,
    );
    expect(liquidity).toBeGreaterThan(0n);

    // Verify: since price is below range, only token0 matters.
    // Changing amount1 should not affect the result.
    const liquidityDifferentAmount1 = getLiquidityForAmounts(
      sqrtPriceBelowRange,
      sqrtLower,
      sqrtUpper,
      amount0,
      amount1 * 10n,
    );
    expect(liquidityDifferentAmount1).toBe(liquidity);
  });

  it("price above range: position is entirely token1", () => {
    const sqrtPriceAboveRange = getSqrtPriceAtTick(2000);
    const liquidity = getLiquidityForAmounts(
      sqrtPriceAboveRange,
      sqrtLower,
      sqrtUpper,
      amount0,
      amount1,
    );
    expect(liquidity).toBeGreaterThan(0n);

    // Changing amount0 should not affect the result.
    const liquidityDifferentAmount0 = getLiquidityForAmounts(
      sqrtPriceAboveRange,
      sqrtLower,
      sqrtUpper,
      amount0 * 10n,
      amount1,
    );
    expect(liquidityDifferentAmount0).toBe(liquidity);
  });

  it("price within range: returns min of both formulas", () => {
    const sqrtPriceInRange = getSqrtPriceAtTick(0); // Q96 — center of the range
    const liquidity = getLiquidityForAmounts(
      sqrtPriceInRange,
      sqrtLower,
      sqrtUpper,
      amount0,
      amount1,
    );
    expect(liquidity).toBeGreaterThan(0n);

    // Doubling one of the amounts should still give the same liquidity
    // because the other side is the bottleneck (min).
    const liquidityDouble0 = getLiquidityForAmounts(
      sqrtPriceInRange,
      sqrtLower,
      sqrtUpper,
      amount0 * 2n,
      amount1,
    );
    // Should be >= liquidity (since the binding constraint is amount1 side)
    expect(liquidityDouble0).toBeGreaterThanOrEqual(liquidity);
  });

  it("throws when sqrtLower >= sqrtUpper", () => {
    const sqrtPrice = getSqrtPriceAtTick(0);
    expect(() =>
      getLiquidityForAmounts(sqrtPrice, sqrtUpper, sqrtLower, amount0, amount1),
    ).toThrow(RangeError);

    expect(() =>
      getLiquidityForAmounts(sqrtPrice, sqrtLower, sqrtLower, amount0, amount1),
    ).toThrow(RangeError);
  });

  it("zero amounts yield zero liquidity", () => {
    const sqrtPrice = getSqrtPriceAtTick(0);
    const liquidity = getLiquidityForAmounts(
      sqrtPrice,
      sqrtLower,
      sqrtUpper,
      0n,
      0n,
    );
    expect(liquidity).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// getAmountsForLiquidity
// ---------------------------------------------------------------------------

describe("getAmountsForLiquidity", () => {
  const sqrtLower = getSqrtPriceAtTick(-1000);
  const sqrtUpper = getSqrtPriceAtTick(1000);

  it("price below range: amount1 is 0", () => {
    const sqrtPriceBelowRange = getSqrtPriceAtTick(-2000);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPriceBelowRange,
      sqrtLower,
      sqrtUpper,
      1_000_000_000_000n,
    );
    expect(amount0).toBeGreaterThan(0n);
    expect(amount1).toBe(0n);
  });

  it("price above range: amount0 is 0", () => {
    const sqrtPriceAboveRange = getSqrtPriceAtTick(2000);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPriceAboveRange,
      sqrtLower,
      sqrtUpper,
      1_000_000_000_000n,
    );
    expect(amount0).toBe(0n);
    expect(amount1).toBeGreaterThan(0n);
  });

  it("price within range: both amounts are positive", () => {
    const sqrtPriceInRange = getSqrtPriceAtTick(0);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPriceInRange,
      sqrtLower,
      sqrtUpper,
      1_000_000_000_000n,
    );
    expect(amount0).toBeGreaterThan(0n);
    expect(amount1).toBeGreaterThan(0n);
  });

  it("throws when sqrtLower >= sqrtUpper", () => {
    const sqrtPrice = getSqrtPriceAtTick(0);
    expect(() =>
      getAmountsForLiquidity(sqrtPrice, sqrtUpper, sqrtLower, 1_000_000_000_000n),
    ).toThrow(RangeError);

    expect(() =>
      getAmountsForLiquidity(sqrtPrice, sqrtLower, sqrtLower, 1_000_000_000_000n),
    ).toThrow(RangeError);
  });

  it("zero liquidity yields zero amounts", () => {
    const sqrtPrice = getSqrtPriceAtTick(0);
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPrice,
      sqrtLower,
      sqrtUpper,
      0n,
    );
    expect(amount0).toBe(0n);
    expect(amount1).toBe(0n);
  });

  describe("round-trip with getLiquidityForAmounts", () => {
    it("recovers amounts within rounding tolerance (price within range)", () => {
      const sqrtPrice = getSqrtPriceAtTick(0);
      const inputAmount0 = 1_000_000_000_000n;
      const inputAmount1 = 1_000_000_000_000n;

      const liquidity = getLiquidityForAmounts(
        sqrtPrice,
        sqrtLower,
        sqrtUpper,
        inputAmount0,
        inputAmount1,
      );

      const { amount0: recovered0, amount1: recovered1 } =
        getAmountsForLiquidity(sqrtPrice, sqrtLower, sqrtUpper, liquidity);

      // Recovered amounts should be <= input (liquidity is the min, so one side
      // may be fully utilized and the other partially).
      expect(recovered0).toBeLessThanOrEqual(inputAmount0);
      expect(recovered1).toBeLessThanOrEqual(inputAmount1);

      // At least one side should be close to the input (the binding constraint).
      // We allow up to 0.1% deviation for bigint rounding.
      const tolerance = inputAmount0 / 1000n; // 0.1%
      const close0 = absDiff(recovered0, inputAmount0) <= tolerance;
      const close1 = absDiff(recovered1, inputAmount1) <= tolerance;
      expect(close0 || close1).toBe(true);
    });

    it("recovers amounts within rounding tolerance (price below range)", () => {
      const sqrtPrice = getSqrtPriceAtTick(-2000);
      const inputAmount0 = 5_000_000_000_000n;
      const inputAmount1 = 999_999_999_999n; // Should be ignored

      const liquidity = getLiquidityForAmounts(
        sqrtPrice,
        sqrtLower,
        sqrtUpper,
        inputAmount0,
        inputAmount1,
      );

      const { amount0: recovered0, amount1: recovered1 } =
        getAmountsForLiquidity(sqrtPrice, sqrtLower, sqrtUpper, liquidity);

      // Price below range: only token0 matters, amount1 should be 0.
      expect(recovered1).toBe(0n);
      // Recovered amount0 should be close to input.
      const tolerance = inputAmount0 / 1000n;
      expectCloseBigInt(recovered0, inputAmount0, tolerance);
    });

    it("recovers amounts within rounding tolerance (price above range)", () => {
      const sqrtPrice = getSqrtPriceAtTick(2000);
      const inputAmount0 = 999_999_999_999n; // Should be ignored
      const inputAmount1 = 5_000_000_000_000n;

      const liquidity = getLiquidityForAmounts(
        sqrtPrice,
        sqrtLower,
        sqrtUpper,
        inputAmount0,
        inputAmount1,
      );

      const { amount0: recovered0, amount1: recovered1 } =
        getAmountsForLiquidity(sqrtPrice, sqrtLower, sqrtUpper, liquidity);

      // Price above range: only token1 matters, amount0 should be 0.
      expect(recovered0).toBe(0n);
      // Recovered amount1 should be close to input.
      const tolerance = inputAmount1 / 1000n;
      expectCloseBigInt(recovered1, inputAmount1, tolerance);
    });
  });
});
