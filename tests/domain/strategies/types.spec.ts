import { describe, it, expect } from "vitest";
import { determineRRMode, calculateSpotMaSpreadBps } from "@domain/strategies/types";

describe("determineRRMode", () => {
  it("returns normal for RR >= 4.0", () => {
    expect(determineRRMode(4.0)).toBe("normal");
  });
  it("returns normal for RR = 5.0", () => {
    expect(determineRRMode(5.0)).toBe("normal");
  });
  it("returns defensive for RR = 3.99", () => {
    expect(determineRRMode(3.99)).toBe("defensive");
  });
  it("returns defensive for RR = 2.0", () => {
    expect(determineRRMode(2.0)).toBe("defensive");
  });
  it("returns crisis for RR = 1.99", () => {
    expect(determineRRMode(1.99)).toBe("crisis");
  });
  it("returns crisis for RR = 0", () => {
    expect(determineRRMode(0)).toBe("crisis");
  });
});

describe("calculateSpotMaSpreadBps", () => {
  it("computes positive spread", () => {
    expect(calculateSpotMaSpreadBps(0.80, 0.75)).toBe(667);
  });
  it("computes negative spread", () => {
    expect(calculateSpotMaSpreadBps(0.70, 0.75)).toBe(-667);
  });
  it("returns 0 for equal values", () => {
    expect(calculateSpotMaSpreadBps(0.75, 0.75)).toBe(0);
  });
  it("returns 0 when MA is 0", () => {
    expect(calculateSpotMaSpreadBps(0.75, 0)).toBe(0);
  });
});
