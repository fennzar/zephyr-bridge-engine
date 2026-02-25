import type { GlobalState } from "@domain/state/types";
import type { AssetId } from "@domain/types";
import type { SemanticStep } from "./routing";
import { isFiniteNumber, toFiniteNumber } from "@shared/format";
import { normalizeSymbol } from "./clip.helpers";

export type NativeRateBasis = "spot" | "moving_average" | "spot_equals_ma";

export type NativeRateShape = {
  base: string;
  quote: string;
  spot: number;
  movingAverage: number | null;
  mint: number;
  redeem: number;
};

export type NativeRateContext = {
  price: number | null;
  mode: "mint" | "redeem";
  basis: NativeRateBasis;
  basisLabel: string;
  label: string;
  spot: number | null;
  movingAverage: number | null;
  mintPrice: number | null;
  redeemPrice: number | null;
  stableAsset: string | null;
  referenceAsset: string | null;
  pairBase: string | null;
  pairQuote: string | null;
  usdBase: string | null;
  usdQuote: string | null;
  usdSpot: number | null;
  usdMovingAverage: number | null;
};

const NATIVE_RATE_BASIS_LABEL: Record<NativeRateBasis, string> = {
  spot: "Spot price",
  moving_average: "MA price",
  spot_equals_ma: "Spot = MA",
};

export function resolveNativeRateContext(
  step: SemanticStep,
  state: GlobalState,
  priceMap: Partial<Record<AssetId, number>>,
): NativeRateContext | null {
  const reserve = state.zephyr?.reserve;
  if (!reserve) return null;

  const op = step.op.find((entry) => entry === "nativeMint" || entry === "nativeRedeem");
  if (!op) return null;

  const mode: "mint" | "redeem" = op === "nativeMint" ? "mint" : "redeem";
  const fromKey = normalizeSymbol(step.from);
  const toKey = normalizeSymbol(step.to);

  const rateCandidates: NativeRateShape[] = [
    reserve.rates.zsd as NativeRateShape,
    reserve.rates.zrs as NativeRateShape,
    reserve.rates.zys as NativeRateShape,
  ];

  const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const zephRate = reserve.rates.zeph;
  const zephUsdFromPriceMap =
    toFiniteNumber(priceMap["ZEPH.n"]) ??
    toFiniteNumber(priceMap["WZEPH.e"]) ??
    toFiniteNumber(priceMap["ZEPH.x"]) ??
    null;
  const zephSpotUsd =
    toNumber(zephRate?.spot) ??
    toNumber(reserve.zephPriceUsd) ??
    zephUsdFromPriceMap;
  const zephMovingAverageUsd =
    toNumber(zephRate?.movingAverage) ??
    zephUsdFromPriceMap;

  const resolveQuoteUsd = (
    assetSymbol: string | null,
  ): { base: string | null; quote: string | null; spot: number | null; movingAverage: number | null } => {
    const symbol = normalizeSymbol(assetSymbol);

    if (symbol === "ZEPH") {
      return {
        base: "ZEPH",
        quote: "USD",
        spot: zephSpotUsd,
        movingAverage: zephMovingAverageUsd,
      };
    }

    if (symbol === "ZSD") {
      const zsd = reserve.rates.zsd;
      const zeph = reserve.rates.zeph;
      const zsdMa = toNumber(zsd?.movingAverage);
      const zephMa = toNumber(zeph?.movingAverage);
      const zephSpot = toNumber(zeph?.spot);
      let movingAverage: number | null = null;
      if (zsdMa != null && zephMa != null) {
        movingAverage = zsdMa * zephMa;
      } else if (zsdMa != null && zephSpot != null) {
        movingAverage = zsdMa * zephSpot;
      } else if (zephMa != null) {
        movingAverage = zephMa;
      }
      return {
        base: zsd?.base ?? "ZSD",
        quote: "USD",
        spot: toNumber(zsd?.spotUSD),
        movingAverage,
      };
    }

    if (symbol === "ZRS") {
      const zrs = reserve.rates.zrs;
      const zeph = reserve.rates.zeph;
      const zrsMa = toNumber(zrs?.movingAverage);
      const zephMa = toNumber(zeph?.movingAverage);
      const zephSpot = toNumber(zeph?.spot);
      let movingAverage: number | null = null;
      if (zrsMa != null && zephMa != null) {
        movingAverage = zrsMa * zephMa;
      } else if (zrsMa != null && zephSpot != null) {
        movingAverage = zrsMa * zephSpot;
      } else if (zephMa != null) {
        movingAverage = zephMa;
      }
      return {
        base: zrs?.base ?? "ZRS",
        quote: "USD",
        spot: toNumber(zrs?.spotUSD),
        movingAverage,
      };
    }

    if (symbol === "ZYS") {
      const zys = reserve.rates.zys;
      const zsd = reserve.rates.zsd;
      const zeph = reserve.rates.zeph;
      const zysMa = toNumber(zys?.movingAverage);
      const zsdMa = toNumber(zsd?.movingAverage);
      const zephMa = toNumber(zeph?.movingAverage);
      const zsdSpotUsd = toNumber(zsd?.spotUSD);
      const zephSpot = toNumber(zeph?.spot);
      let movingAverage: number | null = null;
      if (zysMa != null && zsdMa != null && zephMa != null) {
        movingAverage = zysMa * zsdMa * zephMa;
      } else if (zysMa != null && zsdMa != null && zephSpot != null) {
        movingAverage = zysMa * zsdMa * zephSpot;
      } else if (zysMa != null && zsdSpotUsd != null) {
        movingAverage = zysMa * zsdSpotUsd;
      }
      return {
        base: zys?.base ?? "ZYS",
        quote: "USD",
        spot: toNumber(zys?.spotUSD),
        movingAverage,
      };
    }

    return {
      base: assetSymbol,
      quote: "USD",
      spot: null,
      movingAverage: null,
    };
  };

  for (const rate of rateCandidates) {
    if (!rate) continue;
    const baseKey = normalizeSymbol(rate.base);
    const quoteKey = normalizeSymbol(rate.quote);

    let orientation: "quote_to_base" | "base_to_quote" | null = null;
    if (fromKey === quoteKey && toKey === baseKey) {
      orientation = "quote_to_base";
    } else if (fromKey === baseKey && toKey === quoteKey) {
      orientation = "base_to_quote";
    }
    if (!orientation) continue;

    const rawRate = isFiniteNumber(rate[mode]) && rate[mode] > 0 ? rate[mode] : null;
    if (rawRate == null || rawRate <= 0) continue;

    const convertRate = (input: number | null): number | null => {
      if (!isFiniteNumber(input) || (input as number) <= 0) return null;
      return input as number;
    };

    const price = convertRate(rawRate);
    if (price == null || !Number.isFinite(price) || price <= 0) continue;

    const spot = isFiniteNumber(rate.spot) ? rate.spot : null;
    const movingAverage = isFiniteNumber(rate.movingAverage) ? rate.movingAverage : null;
    const basis = determineNativeRateBasis(mode, rawRate, spot, movingAverage);
    const basisLabel = NATIVE_RATE_BASIS_LABEL[basis];
    const label = mode === "mint" ? "Native mint rate" : "Native redeem rate";
    const mintPrice = convertRate(rate.mint);
    const redeemPrice = convertRate(rate.redeem);
    const stableAsset = rate.base ?? null;
    const referenceAsset = rate.quote ?? null;
    const pairBase = orientation === "quote_to_base" ? rate.base : rate.quote;
    const pairQuote = orientation === "quote_to_base" ? rate.quote : rate.base;
    const usdMetrics = resolveQuoteUsd(rate.quote);

    return {
      price,
      mode,
      basis,
      basisLabel,
      label,
      spot,
      movingAverage,
      mintPrice,
      redeemPrice,
      stableAsset,
      referenceAsset,
      pairBase,
      pairQuote,
      usdBase: usdMetrics.base,
      usdQuote: usdMetrics.quote,
      usdSpot: usdMetrics.spot,
      usdMovingAverage: usdMetrics.movingAverage,
    };
  }

  return null;
}

export function determineNativeRateBasis(
  mode: "mint" | "redeem",
  rawRate: number,
  spot: number | null,
  movingAverage: number | null,
): NativeRateBasis {
  const epsilon = 1e-9;
  const hasSpot = isFiniteNumber(spot);
  const hasMovingAverage = isFiniteNumber(movingAverage);

  if (hasSpot && hasMovingAverage && Math.abs((spot as number) - (movingAverage as number)) <= epsilon) {
    return "spot_equals_ma";
  }

  if (hasMovingAverage && Math.abs(rawRate - (movingAverage as number)) <= epsilon) {
    return "moving_average";
  }

  if (hasSpot && Math.abs(rawRate - (spot as number)) <= epsilon) {
    return "spot";
  }

  if (!hasSpot && hasMovingAverage) {
    return "moving_average";
  }

  if (hasSpot && !hasMovingAverage) {
    return "spot";
  }

  if (hasMovingAverage) {
    if (mode === "mint") {
      return rawRate >= (movingAverage as number) ? "moving_average" : "spot";
    }
    return rawRate <= (movingAverage as number) ? "moving_average" : "spot";
  }

  return "spot";
}
