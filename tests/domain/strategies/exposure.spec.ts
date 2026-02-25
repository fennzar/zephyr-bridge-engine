import { describe, it, expect } from "vitest";

// We test the computeAssetExposure logic indirectly since it's a private
// function in engine.execution.ts. We replicate its logic here for unit testing.
import { findAssetBaseByVariant } from "@domain/assets/variants";
import type { InventorySnapshot } from "@domain/inventory/balances";
import type { AssetId } from "@domain/types";
import type { AssetBase } from "@domain/assets/variants";

function computeAssetExposure(
  fromAsset: AssetId | undefined,
  inventory?: InventorySnapshot,
): number {
  if (!fromAsset || !inventory?.totals) return 0;
  const base = findAssetBaseByVariant(fromAsset);
  if (!base) return 0;
  const assetTotal = inventory.totals[base as AssetBase] ?? 0;
  const portfolioTotal = Object.values(inventory.totals).reduce(
    (sum, v) => sum + (v ?? 0),
    0,
  );
  if (portfolioTotal === 0) return 0;
  return (assetTotal / portfolioTotal) * 100;
}

function makeInventory(totals: Record<string, number>): InventorySnapshot {
  return {
    balances: {},
    totals: totals as InventorySnapshot["totals"],
    options: { includeEvm: true, includePaperMexc: false, includePaperZephyr: false },
  };
}

describe("computeAssetExposure", () => {
  it("returns 0 for undefined asset", () => {
    const inv = makeInventory({ ZEPH: 100, ZSD: 100 });
    expect(computeAssetExposure(undefined, inv)).toBe(0);
  });

  it("returns 0 for undefined inventory", () => {
    expect(computeAssetExposure("WZEPH.e" as AssetId, undefined)).toBe(0);
  });

  it("returns 0 for empty portfolio", () => {
    const inv = makeInventory({});
    expect(computeAssetExposure("WZEPH.e" as AssetId, inv)).toBe(0);
  });

  it("calculates correct exposure percentage", () => {
    const inv = makeInventory({ ZEPH: 200, ZSD: 300, ZRS: 500 });
    // WZEPH.e maps to ZEPH base, total = 200, portfolio = 1000
    const result = computeAssetExposure("WZEPH.e" as AssetId, inv);
    expect(result).toBe(20);
  });

  it("returns 100% when only one asset", () => {
    const inv = makeInventory({ ZEPH: 500 });
    const result = computeAssetExposure("WZEPH.e" as AssetId, inv);
    expect(result).toBe(100);
  });

  it("maps native variants correctly", () => {
    const inv = makeInventory({ ZEPH: 100, ZSD: 400 });
    // ZSD.n maps to ZSD base = 400, total = 500
    const result = computeAssetExposure("ZSD.n" as AssetId, inv);
    expect(result).toBe(80);
  });
});
