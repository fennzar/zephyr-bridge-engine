import { THRESHOLDS_BPS } from "./constants";
import type { GlobalState, EvmPool } from "@domain/state/types";
import { averageNonNull, toFiniteNumber } from "@shared/format";
import type { ArbDirection } from "./routing";

export type ArbMarketDirection = ArbDirection | "aligned";

export interface MarketDexPricing {
  base: string;
  quote: string;
  price: number | null;
  priceUsd: number | null;
}

export interface MarketNativePricing {
  base: string;
  quote: string;
  spot: number | null;
  spotUsd: number | null;
  movingAverage: number | null;
  movingAverageUsd: number | null;
}

export interface MarketCexPricing {
  base: string;
  quote: string;
  price: number | null;
  priceUsd: number | null;
}

export interface MarketPricingBundle {
  dex: MarketDexPricing;
  native: MarketNativePricing | null;
  cex: MarketCexPricing | null;
}

export interface ArbReference {
  label: string;
  price: number | null;
  priceUsd: number | null;
  unitSymbol: string;
  description?: string;
}

export interface ArbMarketAnalysis {
  asset: "ZSD" | "ZEPH" | "ZYS" | "ZRS";
  wrappedSymbol: "WZSD" | "WZEPH" | "WZYS" | "WZRS";
  triggerBps: number;
  direction: ArbMarketDirection;
  gapBps: number | null;
  meetsTrigger: boolean;
  pricing: MarketPricingBundle;
  reference: ArbReference;
}

export function buildPricingFromState(state: GlobalState | null): Record<string, MarketPricingBundle> {
  if (!state) return {};

  const pools = state.evm?.pools ?? {};
  const reserve = state.zephyr?.reserve;
  const rates = reserve?.rates;
  const zephUsd = toFiniteNumber(reserve?.zephPriceUsd);

  const zsdRates = rates?.zsd;
  const zysRates = rates?.zys;
  const zrsRates = rates?.zrs;
  const zephRates = rates?.zeph;

  const wzsdUsd = toFiniteNumber(readPoolPriceFromState(pools, "WZSD.e", "USDT.e")) ?? toFiniteNumber(zsdRates?.spotUSD);

  const map: Record<string, MarketPricingBundle> = {};

  const zsdDexPrice = toFiniteNumber(readPoolPriceFromState(pools, "WZSD.e", "USDT.e"));
  const zsdSpot = toFiniteNumber(zsdRates?.spot);
  const zsdSpotUsd = toFiniteNumber(zsdRates?.spotUSD);
  const zsdMa = toFiniteNumber(zsdRates?.movingAverage);
  const zsdMaUsd = zsdMa != null && zephUsd != null ? zsdMa * zephUsd : null;

  map["ZSD"] = {
    dex: {
      base: "WZSD",
      quote: "USDT",
      price: zsdDexPrice,
      priceUsd: zsdDexPrice,
    },
    native:
      zsdSpot != null || zsdMa != null
        ? {
            base: "ZSD",
            quote: "ZEPH",
            spot: zsdSpot,
            spotUsd: zsdSpotUsd,
            movingAverage: zsdMa,
            movingAverageUsd: zsdMaUsd,
          }
        : null,
    cex: null,
  };

  const zephDexPrice = toFiniteNumber(readPoolPriceFromState(pools, "WZEPH.e", "WZSD.e"));
  const zephDexPriceUsd = zephDexPrice != null && wzsdUsd != null ? zephDexPrice * wzsdUsd : null;
  const zephSpot = toFiniteNumber(zephRates?.spot);
  const zephMa = toFiniteNumber(zephRates?.movingAverage);
  const zephMarket = state.cex?.markets?.["ZEPH_USDT"] ?? null;
  const cexMid = averageNonNull(zephMarket?.bid, zephMarket?.ask);
  const cexPrice = toFiniteNumber(cexMid ?? zephMarket?.bid ?? zephMarket?.ask);

  map["ZEPH"] = {
    dex: {
      base: "WZEPH",
      quote: "WZSD",
      price: zephDexPrice,
      priceUsd: zephDexPriceUsd,
    },
    native:
      zephSpot != null || zephMa != null
        ? {
            base: "ZEPH",
            quote: "USD",
            spot: zephSpot,
            spotUsd: zephSpot,
            movingAverage: zephMa,
            movingAverageUsd: zephMa,
          }
        : null,
    cex:
      cexPrice != null
        ? {
            base: "ZEPH",
            quote: "USDT",
            price: cexPrice,
            priceUsd: cexPrice,
          }
        : null,
  };

  const zysDexPriceRaw = readPoolPriceFromState(pools, "WZYS.e", "WZSD.e");
  const zysDexPrice = toFiniteNumber(zysDexPriceRaw);
  const zysDexPriceUsd = zysDexPrice != null && wzsdUsd != null ? zysDexPrice * wzsdUsd : null;
  const zysSpot = toFiniteNumber(zysRates?.spot);
  const zysSpotUsd = toFiniteNumber(zysRates?.spotUSD);
  const zysMa = toFiniteNumber(zysRates?.movingAverage);
  const zysMaUsd = zysMa != null && wzsdUsd != null ? zysMa * wzsdUsd : null;

  map["ZYS"] = {
    dex: {
      base: "WZYS",
      quote: "WZSD",
      price: zysDexPrice,
      priceUsd: zysDexPriceUsd,
    },
    native:
      zysSpot != null || zysMa != null
        ? {
            base: "ZYS",
            quote: "ZSD",
            spot: zysSpot,
            spotUsd: zysSpotUsd,
            movingAverage: zysMa,
            movingAverageUsd: zysMaUsd,
          }
        : null,
    cex: null,
  };

  const zrsDexPrice = toFiniteNumber(readPoolPriceFromState(pools, "WZRS.e", "WZEPH.e"));
  const zrsDexPriceUsd = zrsDexPrice != null && zephUsd != null ? zrsDexPrice * zephUsd : null;
  const zrsSpot = toFiniteNumber(zrsRates?.spot);
  const zrsSpotUsd = toFiniteNumber(zrsRates?.spotUSD);
  const zrsMa = toFiniteNumber(zrsRates?.movingAverage);
  const zrsMaUsd = zrsMa != null && zephUsd != null ? zrsMa * zephUsd : null;

  map["ZRS"] = {
    dex: {
      base: "WZRS",
      quote: "WZEPH",
      price: zrsDexPrice,
      priceUsd: zrsDexPriceUsd,
    },
    native:
      zrsSpot != null || zrsMa != null
        ? {
            base: "ZRS",
            quote: "ZEPH",
            spot: zrsSpot,
            spotUsd: zrsSpotUsd,
            movingAverage: zrsMa,
            movingAverageUsd: zrsMaUsd,
          }
        : null,
    cex: null,
  };

  return map;
}

export function analyzeArbMarkets(state: GlobalState): ArbMarketAnalysis[] {
  const pricing = buildPricingFromState(state);

  return (["ZSD", "ZEPH", "ZYS", "ZRS"] as const).map((asset) => {
    const bundle = pricing[asset] ?? fallbackPricing(asset);
    const reference = computeReference(asset, bundle);
    const triggerBps = determineTrigger(asset);
    const gapBps = computeGapBps(bundle.dex.priceUsd, reference.priceUsd);
    const direction = resolveDirection(gapBps, triggerBps);
    const meetsTrigger = direction !== "aligned";

    return {
      asset,
      wrappedSymbol: mapWrappedSymbol(asset),
      triggerBps,
      direction,
      gapBps,
      meetsTrigger,
      pricing: bundle,
      reference,
    };
  });
}

function determineTrigger(asset: ArbMarketAnalysis["asset"]): number {
  switch (asset) {
    case "ZSD":
      return THRESHOLDS_BPS.STABLE;
    case "ZEPH":
      return THRESHOLDS_BPS.ZEPH;
    case "ZYS":
      return THRESHOLDS_BPS.ZYS;
    case "ZRS":
    default:
      return THRESHOLDS_BPS.ZRS;
  }
}

function computeGapBps(dexPriceUsd: number | null, referenceUsd: number | null): number | null {
  if (dexPriceUsd == null || referenceUsd == null || !Number.isFinite(dexPriceUsd) || !Number.isFinite(referenceUsd) || referenceUsd === 0) {
    return null;
  }
  return Math.round(((dexPriceUsd - referenceUsd) / referenceUsd) * 10_000);
}

function resolveDirection(gapBps: number | null, triggerBps: number): ArbMarketDirection {
  if (gapBps == null) return "aligned";
  if (gapBps >= triggerBps) return "evm_premium";
  if (gapBps <= -triggerBps) return "evm_discount";
  return "aligned";
}

function computeReference(
  asset: ArbMarketAnalysis["asset"],
  pricing: MarketPricingBundle,
): ArbReference {
  switch (asset) {
    case "ZSD": {
      return {
        label: "USDT peg",
        price: 1,
        priceUsd: 1,
        unitSymbol: "USDT",
        description: "Soft peg target vs USDT",
      };
    }
    case "ZEPH": {
      const cex = pricing.cex?.priceUsd;
      const label = "CEX (ZEPH/USDT)";
      const fallbackNative = pricing.native?.spotUsd ?? null;
      return {
        label,
        price: pricing.cex?.price ?? pricing.native?.spot ?? null,
        priceUsd: cex ?? fallbackNative,
        unitSymbol: "USDT",
        description: "Reference mid from CEX (fallback native spot)",
      };
    }
    case "ZYS": {
      const spotUsd = pricing.native?.spotUsd ?? null;
      return {
        label: "Native (ZYS/ZSD)",
        price: pricing.native?.spot ?? null,
        priceUsd: spotUsd,
        unitSymbol: "USD",
        description: "Native reserve rate",
      };
    }
    case "ZRS": {
      const spotUsd = pricing.native?.spotUsd ?? null;
      return {
        label: "Native (ZRS/ZEPH)",
        price: pricing.native?.spot ?? null,
        priceUsd: spotUsd,
        unitSymbol: "USD",
        description: "Native reserve rate",
      };
    }
    default:
      return {
        label: "Reference",
        price: null,
        priceUsd: null,
        unitSymbol: "USD",
      };
  }
}

function mapWrappedSymbol(asset: ArbMarketAnalysis["asset"]): ArbMarketAnalysis["wrappedSymbol"] {
  switch (asset) {
    case "ZSD":
      return "WZSD";
    case "ZEPH":
      return "WZEPH";
    case "ZYS":
      return "WZYS";
    case "ZRS":
    default:
      return "WZRS";
  }
}

function fallbackPricing(asset: ArbMarketAnalysis["asset"]): MarketPricingBundle {
  const wrapped = mapWrappedSymbol(asset);
  return {
    dex: {
      base: wrapped,
      quote: asset === "ZSD" ? "USDT" : asset === "ZEPH" ? "WZSD" : asset === "ZYS" ? "WZSD" : "WZEPH",
      price: null,
      priceUsd: null,
    },
    native: null,
    cex: null,
  };
}

export function readPoolPriceFromState(pools: Record<string, EvmPool>, assetA: string, assetB: string): number | null {
  const key = [assetA, assetB].sort().join("::");
  const pool = pools[key];
  if (!pool) return null;
  if (pool.base === assetA && pool.quote === assetB) {
    return toFiniteNumber(pool.price);
  }
  if (pool.base === assetB && pool.quote === assetA) {
    if (pool.priceInverse != null) return toFiniteNumber(pool.priceInverse);
    const price = toFiniteNumber(pool.price);
    return price != null && price !== 0 ? 1 / price : null;
  }
  return toFiniteNumber(pool.price) ?? (pool.priceInverse != null ? toFiniteNumber(pool.priceInverse) : null);
}
