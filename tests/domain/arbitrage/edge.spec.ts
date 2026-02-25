import { describe, it, expect } from "vitest";
import { toBps, gasBps, edgeStableRail, edgeZephCex, edgeZysBridge, pickClip } from "@domain/arbitrage/edge";
import { FEES, MAX_POOL_SHARE } from "@domain/arbitrage/constants";

describe("toBps", () => {
  it("converts 0.01 to 100", () => {
    expect(toBps(0.01)).toBe(100);
  });
  it("converts 0 to 0", () => {
    expect(toBps(0)).toBe(0);
  });
  it("converts 0.1 to 1000", () => {
    expect(toBps(0.1)).toBe(1000);
  });
  it("handles negative values", () => {
    expect(toBps(-0.05)).toBe(-500);
  });
});

describe("gasBps", () => {
  it("computes gas as basis points of notional", () => {
    expect(gasBps(5, 1000)).toBe(50);
  });
  it("returns 9999 when notional is 0", () => {
    expect(gasBps(1, 0)).toBe(9999);
  });
});

describe("edgeStableRail", () => {
  it("returns positive edge when WZSD trades at premium", () => {
    // usdtPerWzsd = 0.999 means WZSD costs more than USDT (WZSD premium)
    // gapBps = toBps(1 - 0.999) = toBps(0.001) = 10
    // costs = toBps(0.0003) + gasBps(2, 5000) = 3 + 4 = 7
    // edge = 10 - 7 = 3
    const edge = edgeStableRail(0.999, 2, 5000);
    expect(edge).toBe(3);
  });

  it("returns negative edge when WZSD trades at discount", () => {
    // usdtPerWzsd = 1.001 → gapBps = toBps(1 - 1.001) = toBps(-0.001) = -10
    const edge = edgeStableRail(1.001, 2, 5000);
    expect(edge).toBeLessThan(0);
  });
});

describe("edgeZephCex", () => {
  it("returns positive edge when EVM ZEPH > CEX ZEPH", () => {
    // gross = toBps((0.80 - 0.75) / 0.75) = toBps(0.0667) = 667
    // costs = toBps(0.003 + 0.0003 + 0.001) + gasBps(2, 5000) = 43 + 4 = 47
    // edge = 667 - 47 = 620
    const edge = edgeZephCex(0.80, 0.75, 2, 5000);
    expect(edge).toBe(620);
  });

  it("returns negative edge when EVM ZEPH < CEX ZEPH", () => {
    const edge = edgeZephCex(0.70, 0.75, 2, 5000);
    expect(edge).toBeLessThan(0);
  });
});

describe("pickClip", () => {
  it("respects pool cap and inventory", () => {
    // maxPoolUsd=10000, maxInvUsd=5000, maxShare=0.1
    // cap = min(10000*0.1, 5000) = min(1000, 5000) = 1000
    // 1000 >= 500 → return 1000
    expect(pickClip(10000, 5000)).toBe(1000);
  });

  it("returns 0 when below minimum ticket", () => {
    // maxPoolUsd=1000, maxInvUsd=100
    // cap = min(1000*0.1, 100) = min(100, 100) = 100
    // 100 < 500 → return 0
    expect(pickClip(1000, 100)).toBe(0);
  });
});
