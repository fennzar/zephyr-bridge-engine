import type { AssetId, OpType } from "@domain/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type { ReserveState, AssetRateWithUsd, RateDetail } from "@domain/zephyr";
import { RATE_SCALE } from "@shared/math";
import type { RateDisplay } from "./quoteHelpers";

export type RuntimeContext = SwapEvmContext | NativeOperationContext | CexOperationContext | BridgeOperationContext;

export function isSwapContext(context: RuntimeContext | null | undefined): context is SwapEvmContext {
  return Boolean(context && (context as SwapEvmContext).pool);
}

function isCexTradeContext(
  context: RuntimeContext | null | undefined,
): context is CexOperationContext & { direction: "tradeCEX" } {
  return Boolean(
    context &&
      typeof context === "object" &&
      "direction" in context &&
      (context as CexOperationContext).direction === "tradeCEX" &&
      "market" in context,
  );
}

function isBridgeContext(
  context: RuntimeContext | null | undefined,
  op: OpType | null,
): context is BridgeOperationContext {
  if (!context || !op) return false;
  if (op !== "wrap" && op !== "unwrap") return false;
  return (
    typeof context === "object" &&
    "direction" in context &&
    (context as BridgeOperationContext).direction === op &&
    "minAmountFrom" in context
  );
}

const RATE_TOLERANCE = 1e-9;

function formatNumberRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "n/a";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1 ? 6 : 8;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  return formatter.format(value);
}

function formatScaledRate(value: bigint, precision = 6): string {
  if (RATE_SCALE <= 0n) return "0";
  const negative = value < 0n;
  let abs = negative ? -value : value;

  const scaleFactor = 10n ** BigInt(precision);
  const integer = abs / RATE_SCALE;
  abs %= RATE_SCALE;
  let fractional = (abs * scaleFactor) / RATE_SCALE;

  let fractionalStr = fractional.toString().padStart(precision, "0");
  fractionalStr = fractionalStr.replace(/0+$/, "");

  const result = fractionalStr.length > 0 ? `${integer.toString()}.${fractionalStr}` : integer.toString();
  return negative ? `-${result}` : result;
}

function formatOptionalRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return formatNumberRate(value);
}

function approxEqual(a: number, b: number, tolerance = RATE_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

function describeReference(source: "mint" | "redeem", rate: RateDetail): string {
  const reference = rate.movingAverage ?? rate.spot;
  if (source === "mint") {
    if (rate.mint != null && rate.spot != null && approxEqual(rate.mint, rate.spot)) return "spot";
    if (rate.mint != null && rate.movingAverage != null && approxEqual(rate.mint, rate.movingAverage)) return "moving average";
  } else {
    if (rate.redeem != null && rate.spot != null && approxEqual(rate.redeem, rate.spot)) return "spot";
    if (rate.redeem != null && rate.movingAverage != null && approxEqual(rate.redeem, rate.movingAverage)) return "moving average";
  }
  return rate.movingAverage == null ? "spot" : "reference mix";
}

function assetIdToSymbol(asset: AssetId | null): "ZSD" | "ZRS" | "ZYS" | "ZEPH" | null {
  if (!asset) return null;
  if (asset.startsWith("ZSD")) return "ZSD";
  if (asset.startsWith("ZRS")) return "ZRS";
  if (asset.startsWith("ZYS")) return "ZYS";
  if (asset.startsWith("ZEPH")) return "ZEPH";
  return null;
}

function getReserveEntry(symbol: "ZSD" | "ZRS" | "ZYS", reserve: ReserveState): AssetRateWithUsd {
  if (symbol === "ZSD") return reserve.rates.zsd;
  if (symbol === "ZRS") return reserve.rates.zrs;
  return reserve.rates.zys;
}

function getPolicyEntry(
  symbol: "ZSD" | "ZRS" | "ZYS",
  reserve: ReserveState,
): { mintable?: boolean; redeemable?: boolean } | null {
  if (symbol === "ZSD") return reserve.policy.zsd;
  if (symbol === "ZRS") return reserve.policy.zrs;
  return null;
}

function formatPolicyLabel(enabled: boolean | undefined): string {
  if (enabled == null) return "unknown";
  return enabled ? "enabled" : "disabled";
}

export function deriveRateDisplays(
  operation: OpType | null,
  context: RuntimeContext | null,
  from: AssetId | null,
  to: AssetId | null,
  reserve: ReserveState | null | undefined,
): RateDisplay[] {
  if (!operation || !context || !from || !to) return [];

  if (operation === "swapEVM" && isSwapContext(context)) {
    const rateForward =
      context.direction === "baseToQuote" ? context.pool.price : context.pool.priceInverse;
    const rateInverse =
      context.direction === "baseToQuote" ? context.pool.priceInverse : context.pool.price;

    const entries: RateDisplay[] = [];
    if (rateForward != null && Number.isFinite(rateForward) && rateForward > 0) {
      entries.push({
        label: `Rate (${from}→${to})`,
        value: formatNumberRate(rateForward),
      });
    }
    if (rateInverse != null && Number.isFinite(rateInverse) && rateInverse > 0) {
      entries.push({
        label: `Rate (${to}→${from})`,
        value: formatNumberRate(rateInverse),
      });
    }
    if (context.pool.feeBps != null && Number.isFinite(context.pool.feeBps)) {
      entries.push({
        label: "Pool fee (bps)",
        value: context.pool.feeBps.toString(),
      });
    }
    return entries;
  }

  if (operation === "nativeMint" || operation === "nativeRedeem") {
    if (!("kind" in context)) return [];
    const native = context as NativeOperationContext;
    const entries: RateDisplay[] = [];
    const rateLabel = `${native.kind === "mint" ? "Mint" : "Redeem"} rate (${from}→${to})`;
    entries.push({
      label: rateLabel,
      value: formatScaledRate(native.rate),
    });
    entries.push({
      label: "Conversion fee (bps)",
      value: native.feeBps.toString(),
    });
    if (native.reserveRatio != null && Number.isFinite(native.reserveRatio)) {
      entries.push({
        label: "Reserve ratio (x)",
        value: native.reserveRatio.toFixed(2),
      });
    }

    if (reserve) {
      const symbol =
        native.kind === "mint" ? assetIdToSymbol(to) : assetIdToSymbol(from);
      if (symbol && symbol !== "ZEPH") {
        const rateEntry = getReserveEntry(symbol, reserve);
        entries.push({
          label: `Spot (${rateEntry.base}/${rateEntry.quote})`,
          value: formatOptionalRate(rateEntry.spot),
        });
        entries.push({
          label: `Moving average (${rateEntry.base}/${rateEntry.quote})`,
          value: formatOptionalRate(rateEntry.movingAverage),
        });
        entries.push({
          label: `Mint reference (${rateEntry.base}/${rateEntry.quote})`,
          value: formatOptionalRate(rateEntry.mint),
        });
        entries.push({
          label: "Mint reference source",
          value: describeReference("mint", rateEntry),
        });
        entries.push({
          label: `Redeem reference (${rateEntry.base}/${rateEntry.quote})`,
          value: formatOptionalRate(rateEntry.redeem),
        });
        entries.push({
          label: "Redeem reference source",
          value: describeReference("redeem", rateEntry),
        });
        entries.push({
          label: `USD spot (${rateEntry.base}/USD)`,
          value: formatOptionalRate(rateEntry.spotUSD),
        });

        const policy = getPolicyEntry(symbol, reserve);
        if (policy) {
          entries.push({
            label: "Mint policy",
            value: formatPolicyLabel(policy.mintable),
          });
          entries.push({
            label: "Redeem policy",
            value: formatPolicyLabel(policy.redeemable),
          });
        }
      }
    }
    return entries;
  }

  if (operation === "tradeCEX" && isCexTradeContext(context)) {
    const cex = context;
    const entries: RateDisplay[] = [];
    const market = cex.market;

    if (market) {
      if (market.bid && Number.isFinite(market.bid)) {
        entries.push({
          label: `Best bid (${from}→${to})`,
          value: formatNumberRate(market.bid),
        });
      }
      if (market.ask && Number.isFinite(market.ask)) {
        entries.push({
          label: `Best ask (${from}→${to})`,
          value: formatNumberRate(market.ask),
        });
      }

      if (market.bid && market.ask && Number.isFinite(market.bid) && Number.isFinite(market.ask) && market.bid > 0) {
        const spread = market.ask - market.bid;
        entries.push({
          label: "Spread",
          value: formatNumberRate(spread),
        });
        const spreadBps = (spread / market.bid) * 10_000;
        entries.push({
          label: "Spread (bps)",
          value: formatNumberRate(spreadBps),
        });
      }

      const depth = market.depth;
      if (depth) {
        const topBidSize = depth.bids?.slice(0, 5).reduce((acc: number, level) => {
          if (!Number.isFinite(level.amount)) return acc;
          return acc + level.amount;
        }, 0);
        if (topBidSize && topBidSize > 0) {
          entries.push({
            label: "Bid size (top 5 levels)",
            value: formatNumberRate(topBidSize),
          });
        }
        const topAskSize = depth.asks?.slice(0, 5).reduce((acc: number, level) => {
          if (!Number.isFinite(level.amount)) return acc;
          return acc + level.amount;
        }, 0);
        if (topAskSize && topAskSize > 0) {
          entries.push({
            label: "Ask size (top 5 levels)",
            value: formatNumberRate(topAskSize),
          });
        }
      }
    }

    entries.push({
      label: "Trade side",
      value: cex.tradeSide === "baseToQuote" ? `${from}→${to}` : `${to}→${from}`,
    });

    return entries;
  }

  if (isBridgeContext(context, operation)) {
    const bridge = context;
    const entries: RateDisplay[] = [];
    const fromDecimals = bridge.fromDecimals;
    const toDecimals = bridge.toDecimals;

    const formatTokenAmount = (amount: bigint, decimals: number) => {
      if (amount === 0n) return "0";
      return formatNumberRate(Number(amount) / 10 ** decimals);
    };

    const minAmountHuman = formatTokenAmount(bridge.minAmountFrom, fromDecimals);
    entries.push({
      label: `Minimum ${bridge.from}`,
      value: minAmountHuman,
    });

    if (operation === "wrap" && bridge.flatFeeFrom && bridge.flatFeeFrom > 0n) {
      const flatFeeHuman = formatTokenAmount(bridge.flatFeeFrom, fromDecimals);
      entries.push({
        label: "Flat fee (burn side)",
        value: flatFeeHuman,
      });
    }

    if (operation === "unwrap" && bridge.flatFeeTo && bridge.flatFeeTo > 0n) {
      const flatFeeHuman = formatTokenAmount(bridge.flatFeeTo, toDecimals);
      entries.push({
        label: "Bridge fee (payout side)",
        value: flatFeeHuman,
      });
    }

    return entries;
  }

  return [];
}
