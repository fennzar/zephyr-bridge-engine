import type { ReserveInfoResult } from "@services/zephyr/zephyrd";

const ATOMIC_SCALE = 1_000_000_000_000;

function fromAtomic(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / ATOMIC_SCALE;
}

function fromAtomicNullable(value: number | null | undefined): number {
  if (value == null) return 0;
  return value / ATOMIC_SCALE;
}

export type RateDetail = {
  base: string;
  quote: string;
  spot: number;
  movingAverage: number | null;
  mint?: number | null;
  redeem?: number | null;
};

export type AssetRateWithUsd = RateDetail & {
  spotUSD: number;
  mint: number;
  redeem: number;
};

export type ReserveRates = {
  zeph: RateDetail;
  zrs: AssetRateWithUsd;
  zsd: AssetRateWithUsd;
  zys: AssetRateWithUsd;
};

function buildRate(
  base: string,
  quote: string,
  spotRaw: number | null | undefined,
  maRaw?: number | null,
  options?: { includeSpread?: boolean },
): RateDetail {
  const spot = fromAtomicNullable(spotRaw);
  const movingAverage =
    maRaw != null && Number.isFinite(maRaw) ? fromAtomicNullable(maRaw) : null;
  const includeSpread = options?.includeSpread !== false;
  if (!includeSpread) {
    return {
      base,
      quote,
      spot,
      movingAverage,
    };
  }
  const reference = movingAverage ?? spot;
  const mint = Math.max(spot, reference);
  const redeem = Math.min(spot, reference);
  return {
    base,
    quote,
    spot,
    movingAverage,
    mint,
    redeem,
  };
}

function multiplyRates(
  base: string,
  quote: string,
  a: RateDetail,
  b: RateDetail,
): RateDetail {
  const ma =
    a.movingAverage != null && b.movingAverage != null
      ? a.movingAverage * b.movingAverage
      : null;
  const mintA = a.mint ?? a.spot;
  const mintB = b.mint ?? b.spot;
  const redeemA = a.redeem ?? a.spot;
  const redeemB = b.redeem ?? b.spot;
  return {
    base,
    quote,
    spot: a.spot * b.spot,
    movingAverage: ma,
    mint: mintA * mintB,
    redeem: redeemA * redeemB,
  };
}

export function mapReserveInfo(info: ReserveInfoResult | null) {
  if (!info) return null;

  const zephUsd = buildRate("ZEPH", "USD", info.pr.spot, info.pr.moving_average, { includeSpread: false });
  const zrsZeph = buildRate("ZRS", "ZEPH", info.pr.reserve, info.pr.reserve_ma);
  const zsdZeph = buildRate("ZSD", "ZEPH", info.pr.stable, info.pr.stable_ma);
  const yieldPriceMaField = (info.pr as Record<string, unknown>).yield_price_ma;
  const yieldPriceMaRaw = typeof yieldPriceMaField === "number" ? yieldPriceMaField : null;
  const zysZsd = buildRate("ZYS", "ZSD", info.pr.yield_price, yieldPriceMaRaw);

  const zrsUsd = multiplyRates("ZRS", "USD", zrsZeph, zephUsd);
  const zsdUsd = multiplyRates("ZSD", "USD", zsdZeph, zephUsd);
  const zysUsd = multiplyRates("ZYS", "USD", zysZsd, zsdUsd);

  const reserveRatio = Number(info.reserve_ratio);
  const reserveRatioMovingAverage = Number(info.reserve_ratio_ma);

  const { mint: _ignoredZephMint, redeem: _ignoredZephRedeem, ...zephRate } = zephUsd;

  const zrs: AssetRateWithUsd = {
    ...zrsZeph,
    mint: zrsZeph.mint ?? zrsZeph.spot,
    redeem: zrsZeph.redeem ?? zrsZeph.spot,
    spotUSD: zrsUsd.spot,
  };
  const zsd: AssetRateWithUsd = {
    ...zsdZeph,
    mint: zsdZeph.mint ?? zsdZeph.spot,
    redeem: zsdZeph.redeem ?? zsdZeph.spot,
    spotUSD: zsdUsd.spot,
  };
  const zys: AssetRateWithUsd = {
    ...zysZsd,
    mint: zysZsd.mint ?? zysZsd.spot,
    redeem: zysZsd.redeem ?? zysZsd.spot,
    spotUSD: zysUsd.spot,
  };

  const rates: ReserveRates = {
    zeph: zephRate,
    zrs,
    zsd,
    zys,
  };

  return {
    height: info.height,
    zrsCirc: fromAtomic(info.num_reserves),
    zsdCirc: fromAtomic(info.num_stables),
    zysCirc: fromAtomic(info.num_zyield),
    zephInReserve: fromAtomic(info.zeph_reserve),
    zsdInYieldReserve: fromAtomic(info.zyield_reserve),
    zephPriceUsd: zephUsd.spot,
    rates,
    reserveRatio,
    reserveRatioMovingAverage,
    policy: {
      zsd: {
        mintable: reserveRatio >= 4 && reserveRatioMovingAverage >= 4,
        redeemable: true,
      },
      zrs: {
        mintable:
          reserveRatio >= 4 && reserveRatioMovingAverage >= 4 && reserveRatio <= 8 && reserveRatioMovingAverage <= 8,
        redeemable: reserveRatio >= 4 && reserveRatioMovingAverage >= 4,
      },
    },
  };
}

export type ReserveState = NonNullable<ReturnType<typeof mapReserveInfo>>;

// ------------------------------------------------------------------
// Compact reserve snapshot (used by lightweight dashboards)
// ------------------------------------------------------------------

export type ReserveQuickView = {
  height: number;
  rrPercent: number;
  zsdPegUsd: number;
  zysPerZsd: number;
  zrsPerZeph: number;
  yieldHalted: boolean;
};

type RawReserve = Partial<{
  height: number | string;
  rrPercent: number | string;
  reserveRatioPercent: number | string;
  zysPerZsd: number | string;
  zrsPerZeph: number | string;
}> &
  Partial<ReserveInfoResult>;

export function mapReserve(raw: RawReserve): ReserveQuickView {
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
    return Number.NaN;
  };

  const height = toNumber(raw.height);
  const pr = (raw.pr ?? null) as ReserveInfoResult["pr"] | null;

  let rr = toNumber(
    (raw as { rrPercent?: unknown }).rrPercent ?? (raw as { reserveRatioPercent?: unknown }).reserveRatioPercent
  );
  if (!Number.isFinite(rr)) {
    const headlineRatio = toNumber((raw as { reserve_ratio?: unknown }).reserve_ratio);
    if (Number.isFinite(headlineRatio)) {
      rr = headlineRatio;
    } else if (pr) {
      const prRatio = toNumber(pr.reserve_ratio);
      if (Number.isFinite(prRatio)) {
        rr = prRatio;
      }
    }
  }
  if (Number.isFinite(rr)) {
    const hasFractional = Math.abs(rr % 1) > 0;
    if (hasFractional || (rr > 0 && rr < 10)) {
      rr *= 100;
    }
  }

  let zysPerZsd = toNumber((raw as { zysPerZsd?: unknown }).zysPerZsd);
  if (!Number.isFinite(zysPerZsd) && pr) {
    zysPerZsd = fromAtomicNullable(pr.yield_price);
  }

  let zrsPerZeph = toNumber((raw as { zrsPerZeph?: unknown }).zrsPerZeph);
  if (!Number.isFinite(zrsPerZeph) && pr) {
    zrsPerZeph = fromAtomicNullable(pr.reserve);
  }

  return {
    height: Number.isFinite(height) ? height : 0,
    rrPercent: Number.isFinite(rr) ? rr : 0,
    zsdPegUsd: 1,
    zysPerZsd: Number.isFinite(zysPerZsd) ? zysPerZsd : Number.NaN,
    zrsPerZeph: Number.isFinite(zrsPerZeph) ? zrsPerZeph : Number.NaN,
    yieldHalted: Number.isFinite(rr) ? rr < 200 : false,
  };
}
