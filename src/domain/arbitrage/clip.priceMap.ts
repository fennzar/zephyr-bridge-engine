import type { GlobalState, EvmPool } from "@domain/state/types";
import type { AssetId } from "@domain/types";
import type { SemanticStep } from "./routing";
import { averageNonNull, isFiniteNumber, toFiniteNumber } from "@shared/format";
import { readSpotUsd } from "./clip.helpers";

const DEFAULT_CLIP_POOL_SHARE = 0.1;

export function buildClipPriceMap(state: GlobalState): Partial<Record<AssetId, number>> {
  const prices: Partial<Record<AssetId, number>> = {
    "USDT.e": 1,
    "USDT.x": 1,
    "WZSD.e": 1,
    "ZSD.n": 1,
  };

  const reserve = state.zephyr?.reserve;
  if (reserve) {
    const zephUsd = toFiniteNumber(reserve.zephPriceUsd) ?? readSpotUsd(reserve.rates?.zeph);
    if (zephUsd != null) {
      prices["WZEPH.e"] = zephUsd;
      prices["ZEPH.n"] = zephUsd;
      prices["ZEPH.x"] = zephUsd;
    }

    const zsdUsd = readSpotUsd(reserve.rates?.zsd) ?? toFiniteNumber(reserve.rates?.zsd?.spot);
    if (zsdUsd != null) {
      prices["WZSD.e"] = zsdUsd;
      prices["ZSD.n"] = zsdUsd;
    }

    const reserveExtras = reserve as Record<string, unknown>;
    const zrsPerZeph = toFiniteNumber(reserveExtras?.zrsPerZeph);
    const zephUsdFallback = prices["WZEPH.e"] ?? prices["ZEPH.n"] ?? toFiniteNumber(reserve.zephPriceUsd) ?? null;
    const zrsUsd =
      readSpotUsd(reserve.rates?.zrs) ??
      (zrsPerZeph != null && zephUsdFallback != null ? zrsPerZeph * zephUsdFallback : null);
    if (zrsUsd != null) {
      prices["WZRS.e"] = zrsUsd;
      prices["ZRS.n"] = zrsUsd;
    }

    const zysRate = reserve.rates?.zys;
    const zysSpot = toFiniteNumber(zysRate?.spot);
    const zysPerZsd = toFiniteNumber(reserveExtras?.zysPerZsd);
    const zysUsd =
      readSpotUsd(zysRate) ??
      (zysSpot != null ? zysSpot * (prices["WZSD.e"] ?? 1) : null) ??
      (zysPerZsd != null ? zysPerZsd * (prices["WZSD.e"] ?? 1) : null);
    if (zysUsd != null) {
      prices["WZYS.e"] = zysUsd;
      prices["ZYS.n"] = zysUsd;
    }
  }

  const zephMarket = state.cex?.markets?.["ZEPH_USDT"];
  if (zephMarket) {
    const cexPrice = zephMarket.last ?? averageNonNull(
      zephMarket.bid,
      zephMarket.ask,
      zephMarket.depth?.bids?.[0]?.price,
      zephMarket.depth?.asks?.[0]?.price,
    );
    if (cexPrice != null) {
      prices["WZEPH.e"] = cexPrice;
      prices["ZEPH.n"] = cexPrice;
      prices["ZEPH.x"] = cexPrice;
    }
  }

  return prices;
}

function derivePoolPrice(pool: EvmPool): number | null {
  const base = isFiniteNumber(pool.totalBase) ? pool.totalBase : null;
  const quote = isFiniteNumber(pool.totalQuote) ? pool.totalQuote : null;
  if (base == null || quote == null || base <= 0) return null;
  return quote / base;
}

export function resolveAssetUsdPrice(asset: AssetId, prices: Partial<Record<AssetId, number>>, pool: EvmPool | null): number | null {
  const direct = prices[asset];
  if (isFiniteNumber(direct)) return direct;
  if (!pool) return null;

  const counterpart = asset === pool.base ? pool.quote : asset === pool.quote ? pool.base : null;
  if (!counterpart) return null;

  const counterpartPrice = prices[counterpart];
  if (!isFiniteNumber(counterpartPrice)) return null;

  const poolPrice = derivePoolPrice(pool);
  if (poolPrice == null) return null;

  if (asset === pool.base) {
    return poolPrice * counterpartPrice;
  }
  return poolPrice > 0 ? (1 / poolPrice) * counterpartPrice : null;
}

export function resolveTargetPrice(step: SemanticStep, prices: Partial<Record<AssetId, number>>): number | null {
  const from = step.from as AssetId;
  const to = step.to as AssetId;
  const fromPrice = prices[from];
  const toPrice = prices[to];
  if (!isFiniteNumber(fromPrice) || !isFiniteNumber(toPrice) || fromPrice <= 0) return null;
  return toPrice / fromPrice;
}

export function resolveReferencePrice(step: SemanticStep, prices: Partial<Record<AssetId, number>>): number | null {
  const from = step.from as AssetId;
  const basePrice = prices[from];
  if (isFiniteNumber(basePrice)) return basePrice as number;
  return resolveTargetPrice(step, prices);
}

export function findEvmPool(state: GlobalState, assetA: AssetId | undefined, assetB: AssetId | undefined): EvmPool | null {
  if (!assetA || !assetB) return null;
  const pools = state.evm?.pools;
  if (!pools) return null;
  const key = [assetA, assetB].sort().join("::");
  return pools[key] ?? null;
}

export function estimatePoolAssetCapacity(pool: EvmPool | null, asset: AssetId): number | null {
  if (!pool) return null;
  const sideTotal = asset === pool.base ? pool.totalBase : asset === pool.quote ? pool.totalQuote : null;
  if (isFiniteNumber(sideTotal) && sideTotal > 0) {
    return sideTotal * DEFAULT_CLIP_POOL_SHARE;
  }
  return null;
}
