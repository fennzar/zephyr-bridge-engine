import { describe, it, expect } from "vitest";
import {
  ARB_DEFS,
  findArbLeg,
  listLegSegments,
  encodeLegSegmentKey,
  decodeLegSegmentKey,
} from "@domain/arbitrage/routing";

describe("ARB_DEFS", () => {
  it("has exactly 8 legs (4 assets × 2 directions)", () => {
    expect(ARB_DEFS).toHaveLength(8);
  });

  it("covers all 4 assets", () => {
    const assets = [...new Set(ARB_DEFS.map((l) => l.asset))];
    expect(assets.sort()).toEqual(["ZEPH", "ZRS", "ZSD", "ZYS"]);
  });

  it("each asset has both evm_discount and evm_premium", () => {
    for (const asset of ["ZEPH", "ZSD", "ZRS", "ZYS"] as const) {
      const dirs = ARB_DEFS.filter((l) => l.asset === asset).map((l) => l.direction);
      expect(dirs.sort()).toEqual(["evm_discount", "evm_premium"]);
    }
  });

  it("only ZEPH has CEX close path", () => {
    const withCex = ARB_DEFS.filter((l) => l.close.cex != null);
    expect(withCex).toHaveLength(2); // ZEPH discount + ZEPH premium
    expect(withCex.every((l) => l.asset === "ZEPH")).toBe(true);
  });

  // ZEPH legs
  it("ZEPH evm_discount: open WZSD.e→WZEPH.e, close native ZEPH.n→ZSD.n nativeMint", () => {
    const leg = findArbLeg("ZEPH", "evm_discount")!;
    expect(leg.open[0]).toEqual({ from: "WZSD.e", to: "WZEPH.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZEPH.n", to: "ZSD.n", op: ["nativeMint"] });
    expect(leg.close.cex![0]).toEqual({ from: "ZEPH.x", to: "USDT.x", op: ["tradeCEX"] });
  });

  it("ZEPH evm_premium: open WZEPH.e→WZSD.e, close native ZSD.n→ZEPH.n nativeRedeem", () => {
    const leg = findArbLeg("ZEPH", "evm_premium")!;
    expect(leg.open[0]).toEqual({ from: "WZEPH.e", to: "WZSD.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZSD.n", to: "ZEPH.n", op: ["nativeRedeem"] });
    expect(leg.close.cex![0]).toEqual({ from: "USDT.x", to: "ZEPH.x", op: ["tradeCEX"] });
  });

  // ZSD legs
  it("ZSD evm_discount: open USDT.e→WZSD.e, close native unwrap", () => {
    const leg = findArbLeg("ZSD", "evm_discount")!;
    expect(leg.open[0]).toEqual({ from: "USDT.e", to: "WZSD.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "WZSD.e", to: "ZSD.n", op: ["unwrap"] });
    expect(leg.close.cex).toBeUndefined();
  });

  it("ZSD evm_premium: open WZSD.e→USDT.e, close native nativeMint", () => {
    const leg = findArbLeg("ZSD", "evm_premium")!;
    expect(leg.open[0]).toEqual({ from: "WZSD.e", to: "USDT.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZEPH.n", to: "ZSD.n", op: ["nativeMint"] });
  });

  // ZRS legs
  it("ZRS evm_discount: open WZEPH.e→WZRS.e, close native ZRS.n→ZEPH.n nativeRedeem", () => {
    const leg = findArbLeg("ZRS", "evm_discount")!;
    expect(leg.open[0]).toEqual({ from: "WZEPH.e", to: "WZRS.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZRS.n", to: "ZEPH.n", op: ["nativeRedeem"] });
    expect(leg.close.cex).toBeUndefined();
  });

  it("ZRS evm_premium: open WZRS.e→WZEPH.e, close native ZEPH.n→ZRS.n nativeRedeem", () => {
    const leg = findArbLeg("ZRS", "evm_premium")!;
    expect(leg.open[0]).toEqual({ from: "WZRS.e", to: "WZEPH.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZEPH.n", to: "ZRS.n", op: ["nativeRedeem"] });
  });

  // ZYS legs
  it("ZYS evm_discount: open WZSD.e→WZYS.e, close native ZYS.n→ZSD.n nativeRedeem", () => {
    const leg = findArbLeg("ZYS", "evm_discount")!;
    expect(leg.open[0]).toEqual({ from: "WZSD.e", to: "WZYS.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZYS.n", to: "ZSD.n", op: ["nativeRedeem"] });
  });

  it("ZYS evm_premium: open WZYS.e→WZSD.e, close native ZSD.n→ZYS.n nativeMint", () => {
    const leg = findArbLeg("ZYS", "evm_premium")!;
    expect(leg.open[0]).toEqual({ from: "WZYS.e", to: "WZSD.e", op: ["swapEVM"] });
    expect(leg.close.native[0]).toEqual({ from: "ZSD.n", to: "ZYS.n", op: ["nativeMint"] });
  });
});

describe("findArbLeg", () => {
  it("returns correct leg for known asset/direction", () => {
    const leg = findArbLeg("ZEPH", "evm_premium");
    expect(leg).not.toBeNull();
    expect(leg!.asset).toBe("ZEPH");
    expect(leg!.direction).toBe("evm_premium");
  });

  it("returns null for unknown combination", () => {
    // @ts-expect-error testing invalid input
    expect(findArbLeg("UNKNOWN", "evm_premium")).toBeNull();
  });
});

describe("listLegSegments", () => {
  it("returns correct segments with kind and index", () => {
    const leg = findArbLeg("ZEPH", "evm_discount")!;
    const segments = listLegSegments(leg);
    expect(segments.length).toBeGreaterThanOrEqual(3); // open + native + cex
    expect(segments[0].kind).toBe("open");
    expect(segments[0].index).toBe(0);
    const nativeSegments = segments.filter((s) => s.kind === "close_native");
    expect(nativeSegments.length).toBeGreaterThan(0);
    const cexSegments = segments.filter((s) => s.kind === "close_cex");
    expect(cexSegments.length).toBeGreaterThan(0);
  });
});

describe("encodeLegSegmentKey / decodeLegSegmentKey", () => {
  it("encodes open:0", () => {
    expect(encodeLegSegmentKey("open", 0)).toBe("open:0");
  });

  it("encodes close_native:1", () => {
    expect(encodeLegSegmentKey("close_native", 1)).toBe("close_native:1");
  });

  it("decodes open:0", () => {
    expect(decodeLegSegmentKey("open:0")).toEqual({ kind: "open", index: 0 });
  });

  it("returns null for null input", () => {
    expect(decodeLegSegmentKey(null)).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(decodeLegSegmentKey("invalid")).toBeNull();
  });
});
