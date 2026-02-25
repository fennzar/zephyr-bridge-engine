import type { PoolOverview } from "@services/evm/uniswapV4";
import type { MexcDepthSummary } from "@services/mexc/market";
import type { ReserveInfoResult } from "@services/zephyr/zephyrd";

import type { BalanceSnapshot } from "@domain/inventory/types";
import { mapReserve, mapReserveInfo, type ReserveQuickView } from "@domain/zephyr/reserve";

import type { AssetOverview, AssetStatus, PriceComparison } from "./types";

export type DexPricing = {
  base: string;
  quote: string;
  price: number | null;
  priceUsd: number | null;
};

export type NativePricing = {
  base: string;
  quote: string;
  spot: number | null;
  spotUsd: number | null;
  movingAverage: number | null;
  movingAverageUsd: number | null;
};

export type CexPricing = {
  base: string;
  quote: string;
  price: number | null;
  priceUsd: number | null;
} | null;

export type ArbAsset = AssetOverview & {
  pricing: {
    dex: DexPricing;
    native: NativePricing | null;
    cex: CexPricing;
  };
};

export type ArbitrageSnapshot = {
  generatedAt: string;
  pools: PoolOverview[];
  mexcMarket: MexcDepthSummary | null;
  reserveState: Pick<ReserveQuickView, "height" | "rrPercent" | "yieldHalted" | "zysPerZsd" | "zrsPerZeph"> | null;
  balances: BalanceSnapshot;
  assets: ArbAsset[];
};

export type BuildArbitrageSnapshotParams = {
  pools: PoolOverview[];
  mexcMarket: MexcDepthSummary | null;
  reserveInfo: ReserveInfoResult | null;
  balances: BalanceSnapshot;
};

export function buildArbitrageSnapshotView({
  pools,
  mexcMarket,
  reserveInfo,
  balances,
}: BuildArbitrageSnapshotParams): ArbitrageSnapshot {
  const reserveQuickView = mapReserve(reserveInfo ?? {});
  const reserveDetailed = mapReserveInfo(reserveInfo);

  const usdt_wzsd = findPool(pools, "USDT", "WZSD");
  const wzys_wzsd = findPool(pools, "WZYS", "WZSD");
  const wzeph_wzsd = findPool(pools, "WZEPH", "WZSD");
  const wzeph_wzrs = findPool(pools, "WZEPH", "WZRS");

  const wzsd_usd = Number(usdt_wzsd?.lastPrice ?? 1);
  const zys_per_zsd_dex = Number(wzys_wzsd?.lastPrice ?? Number.NaN);
  const zys_per_zsd_ref = Number(reserveQuickView.zysPerZsd ?? Number.NaN);

  const wzeph_in_wzsd = Number(wzeph_wzsd?.lastPrice ?? Number.NaN);
  const zeph_usd_evm = Number.isFinite(wzeph_in_wzsd) ? wzeph_in_wzsd * wzsd_usd : Number.NaN;

  const mexcWithSymbol =
    mexcMarket && Number.isFinite(mexcMarket.mid) ? { ...mexcMarket, symbol: "ZEPH/USDT" } : null;

  const reserveState = reserveQuickView
    ? {
        height: reserveQuickView.height,
        rrPercent: reserveQuickView.rrPercent,
        yieldHalted: reserveQuickView.yieldHalted,
        zysPerZsd: reserveQuickView.zysPerZsd,
        zrsPerZeph: reserveQuickView.zrsPerZeph,
      }
    : null;

  const assets: ArbAsset[] = [
    withPricing(buildZsdAsset(), buildZsdPricing()),
    withPricing(buildZephAsset(), buildZephPricing()),
    withPricing(buildZysAsset(), buildZysPricing()),
    withPricing(buildZrsAsset(), buildZrsPricing()),
  ];

  return {
    generatedAt: new Date().toISOString(),
    pools,
    mexcMarket: mexcWithSymbol,
    reserveState,
    balances,
    assets,
  };

  function withPricing<T extends AssetOverview>(asset: T, pricing: ArbAsset["pricing"]): ArbAsset {
    return { ...asset, pricing };
  }

  function buildZsdAsset(): AssetOverview {
    const zsd_comp = mkComp(usdt_wzsd, "USDT", wzsd_usd, 1);
    const zsd_status = mkStatus(zsd_comp.dexPrice, "USDT peg", 1, "USDT parity target is $1.00", 1);
    return {
      asset: "ZSD",
      wrappedSymbol: "WZSD",
      thresholdBps: 12,
      status: zsd_status,
      comparisons: [zsd_comp],
      primaryComparison: zsd_comp,
      opportunities: [],
    };
  }

  function buildZephAsset(): AssetOverview {
    const zeph_comp = mkComp(wzeph_wzsd, "WZSD", Number(wzeph_wzsd?.lastPrice ?? Number.NaN), wzsd_usd);
    const zeph_ref_mid = Number(mexcMarket?.mid ?? Number.NaN);
    const zeph_status = mkStatus(
      zeph_comp.dexPrice,
      "CEX (ZEPH/USDT)",
      zeph_ref_mid,
      "Reference from MEXC ZEPH/USDT",
      1,
    );
    return {
      asset: "ZEPH",
      wrappedSymbol: "WZEPH",
      thresholdBps: 100,
      status: zeph_status,
      comparisons: [zeph_comp],
      primaryComparison: zeph_comp,
      opportunities: [],
    };
  }

  function buildZysAsset(): AssetOverview {
    const zys_comp = mkComp(wzys_wzsd, "WZSD", zys_per_zsd_dex, wzsd_usd);
    const zys_status = mkStatus(
      zys_comp.dexPrice,
      "Native (ZYS:ZSD)",
      zys_per_zsd_ref,
      "Native ZYS:ZSD reference rate",
      1,
    );
    return {
      asset: "ZYS",
      wrappedSymbol: "WZYS",
      thresholdBps: 30,
      status: zys_status,
      comparisons: [zys_comp],
      primaryComparison: zys_comp,
      opportunities: [],
      yieldHalted: reserveQuickView?.yieldHalted,
    };
  }

  function buildZrsAsset(): AssetOverview {
    const nativeZrsPerZeph = Number(reserveQuickView?.zrsPerZeph ?? Number.NaN);
    const zrs_dex_price =
      wzeph_wzrs && Number.isFinite(wzeph_wzrs.lastPrice ?? Number.NaN) ? Number(wzeph_wzrs.lastPrice) : Number.NaN;

    const usdPerWzrsFromNative =
      Number.isFinite(zeph_usd_evm) && Number.isFinite(nativeZrsPerZeph) && nativeZrsPerZeph !== 0
        ? zeph_usd_evm / nativeZrsPerZeph
        : Number.NaN;
    const usdPerWzrsFromDex =
      Number.isFinite(zeph_usd_evm) && Number.isFinite(zrs_dex_price) && zrs_dex_price !== 0
        ? zeph_usd_evm / zrs_dex_price
        : Number.NaN;
    const zrs_unit_usd = Number.isFinite(usdPerWzrsFromNative) ? usdPerWzrsFromNative : usdPerWzrsFromDex;

    const zrs_comp = mkComp(
      wzeph_wzrs,
      "WZEPH",
      zrs_dex_price,
      Number.isFinite(zeph_usd_evm) ? zeph_usd_evm : zrs_unit_usd,
    );
    const zrs_status = mkStatus(
      zrs_comp.dexPrice,
      "Native (ZRS/ZEPH)",
      nativeZrsPerZeph,
      "Native ZRS per ZEPH reference (RR-gated mint/redeem).",
      zrs_unit_usd,
    );
    return {
      asset: "ZRS",
      wrappedSymbol: "WZRS",
      thresholdBps: 100,
      status: zrs_status,
      comparisons: [zrs_comp],
      primaryComparison: zrs_comp,
      opportunities: [],
    };
  }

  function buildZsdPricing(): ArbAsset["pricing"] {
    const dexPrice = toFinite(wzsd_usd);
    const native = reserveDetailed?.rates?.zsd;
    const zephUsd = toFinite(reserveDetailed?.zephPriceUsd);
    const spot = toFinite(native?.spot);
    const ma = toFinite(native?.movingAverage);
    const spotUsd = toFinite(native?.spotUSD ?? (spot != null && zephUsd != null ? spot * zephUsd : null));
    const maUsd = ma != null && zephUsd != null ? ma * zephUsd : null;

    return {
      dex: {
        base: "WZSD",
        quote: "USDT",
        price: dexPrice,
        priceUsd: dexPrice,
      },
      native:
        native && (spot != null || ma != null)
          ? {
              base: "ZSD",
              quote: "ZEPH",
              spot,
              spotUsd,
              movingAverage: ma,
              movingAverageUsd: maUsd,
            }
          : null,
      cex: null,
    };
  }

  function buildZephPricing(): ArbAsset["pricing"] {
    const dexPrice = toFinite(readPoolPrice(wzeph_wzsd, "WZEPH", "WZSD"));
    const dexUsd = dexPrice != null && wzsd_usd ? dexPrice * wzsd_usd : null;
    const native = reserveDetailed?.rates?.zeph;
    const spot = toFinite(native?.spot);
    const ma = toFinite(native?.movingAverage);
    const cexPrice = toFinite(mexcMarket?.mid);

    return {
      dex: {
        base: "WZEPH",
        quote: "WZSD",
        price: dexPrice,
        priceUsd: dexUsd,
      },
      native:
        native && (spot != null || ma != null)
          ? {
              base: "ZEPH",
              quote: "USD",
              spot,
              spotUsd: spot,
              movingAverage: ma,
              movingAverageUsd: ma,
            }
          : null,
      cex: {
        base: "ZEPH",
        quote: "USDT",
        price: cexPrice,
        priceUsd: cexPrice,
      },
    };
  }

  function buildZysPricing(): ArbAsset["pricing"] {
    const dexPriceCandidate = readPoolPrice(wzys_wzsd, "WZYS", "WZSD");
    const dexPrice = toFinite(dexPriceCandidate != null ? dexPriceCandidate : zys_per_zsd_dex);
    const dexUsd = dexPrice != null && wzsd_usd ? dexPrice * wzsd_usd : null;
    const native = reserveDetailed?.rates?.zys;
    const spot = toFinite(native?.spot);
    const ma = toFinite(native?.movingAverage);
    const spotUsd = toFinite(native?.spotUSD);
    const zsdSpotUsd = toFinite(reserveDetailed?.rates?.zsd?.spotUSD);
    const maUsd = ma != null && zsdSpotUsd != null ? ma * zsdSpotUsd : null;

    return {
      dex: {
        base: "WZYS",
        quote: "WZSD",
        price: dexPrice,
        priceUsd: dexUsd,
      },
      native:
        native && (spot != null || ma != null)
          ? {
              base: "ZYS",
              quote: "ZSD",
              spot,
              spotUsd,
              movingAverage: ma,
              movingAverageUsd: maUsd,
            }
          : null,
      cex: null,
    };
  }

  function buildZrsPricing(): ArbAsset["pricing"] {
    const dexPriceRaw = readPoolPrice(wzeph_wzrs, "WZRS", "WZEPH");
    const dexPrice = toFinite(dexPriceRaw);
    const dexUsd = dexPrice != null && zeph_usd_evm ? dexPrice * zeph_usd_evm : null;
    const native = reserveDetailed?.rates?.zrs;
    const spot = toFinite(native?.spot);
    const ma = toFinite(native?.movingAverage);
    const spotUsd = toFinite(native?.spotUSD);
    const maUsd = ma != null && zeph_usd_evm ? ma * zeph_usd_evm : null;

    return {
      dex: {
        base: "WZRS",
        quote: "WZEPH",
        price: dexPrice,
        priceUsd: dexUsd,
      },
      native:
        native && (spot != null || ma != null)
          ? {
              base: "ZRS",
              quote: "ZEPH",
              spot,
              spotUsd,
              movingAverage: ma,
              movingAverageUsd: maUsd,
            }
          : null,
      cex: null,
    };
  }

  function mkStatus(
    dexPrice: number,
    refLabel: string,
    refPrice: number,
    refDesc: string,
    unitUsd: number,
  ): AssetStatus {
    const refUsd = refPrice * unitUsd;
    if (!Number.isFinite(dexPrice) || !Number.isFinite(refPrice)) {
      return {
        mode: "aligned",
        gapBps: 0,
        referenceLabel: refLabel,
        referencePrice: refPrice,
        referencePriceUsd: refUsd,
        referenceDescription: refDesc,
      };
    }
    const gapBps = Math.round(((dexPrice - refPrice) / refPrice) * 10_000);
    const mode: AssetStatus["mode"] = Math.abs(gapBps) < 1 ? "aligned" : gapBps > 0 ? "premium" : "discount";
    return {
      mode,
      gapBps,
      referenceLabel: refLabel,
      referencePrice: refPrice,
      referencePriceUsd: refUsd,
      referenceDescription: refDesc,
      caseType: mode === "aligned" ? undefined : (mode as "premium" | "discount"),
    };
  }

  function mkComp(pool: PoolOverview | undefined, unitSymbol: string, dexPrice: number, unitUsd: number): PriceComparison {
    const dexUsd = Number.isFinite(dexPrice) ? dexPrice * unitUsd : Number.NaN;
    return {
      unitSymbol,
      dexPrice,
      dexPriceUsd: dexUsd,
      pool: pool ?? null,
    };
  }

  function findPool(poolsList: PoolOverview[], a: string, b: string): PoolOverview | undefined {
    return poolsList.find(
      (p) => p.base.symbol.toUpperCase() === a.toUpperCase() && p.quote.symbol.toUpperCase() === b.toUpperCase(),
    );
  }

  function toFinite(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function readPoolPrice(pool: PoolOverview | undefined, desiredBase: string, desiredQuote: string): number | null {
    if (!pool || !Number.isFinite(pool.lastPrice ?? Number.NaN)) return null;
    const price = Number(pool.lastPrice);
    const poolBase = normalizeSymbol(pool.base.symbol);
    const poolQuote = normalizeSymbol(pool.quote.symbol);
    const wantBase = normalizeSymbol(desiredBase);
    const wantQuote = normalizeSymbol(desiredQuote);
    if (poolBase === wantBase && poolQuote === wantQuote) return price;
    if (poolBase === wantQuote && poolQuote === wantBase) {
      return price !== 0 ? 1 / price : null;
    }
    return null;
  }

  function normalizeSymbol(symbol: string | null | undefined): string {
    if (!symbol) return "";
    return symbol.replace(/\.(e|n)$/i, "").toUpperCase();
  }
}
