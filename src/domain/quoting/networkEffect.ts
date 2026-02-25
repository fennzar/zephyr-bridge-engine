import type { GlobalState } from "@domain/state/types";
import type { ReserveState } from "@domain/zephyr/reserve";
 import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
 import type {
   OperationQuoteRequest,
   OperationQuoteResponse,
   NetworkEffect,
   NetworkEffectMetric,
 } from "./types";
 
const NATIVE_DECIMALS = 12;
const NATIVE_SCALE = 10 ** NATIVE_DECIMALS;

function fromNative(amount: bigint): number {
  return Number(amount) / NATIVE_SCALE;
}

function calcDeltaPercent(oldValue: number, delta: number): number | null {
  if (oldValue === 0) return null;
  return (delta / oldValue) * 100;
}

function buildMetric(
  key: string,
  label: string,
  format: "token" | "ratio",
  oldValue: number,
  newValue: number,
): NetworkEffectMetric {
  const delta = newValue - oldValue;
  const deltaPercent = calcDeltaPercent(oldValue, delta);
  return {
    key,
    label,
    format,
    old: oldValue,
    delta,
    new: newValue,
    deltaPercent,
  };
}

interface NativeEffectResult {
  effect: NetworkEffect | null;
  constraints: { allowed: boolean; reasons: string[] };
}

function computeMintEffect(
  request: OperationQuoteRequest,
  response: OperationQuoteResponse,
  context: NativeOperationContext,
  reserve: ReserveState,
): NativeEffectResult {
  if (!response.amountOut) {
    return {
      effect: null,
      constraints: { allowed: false, reasons: ["Quote produced no output"] },
    };
  }
  const amountInRaw = request.amountIn ?? null;
  const mintedRaw = response.amountOut;

  const mintedToken = context.to;
  const mintedAmount = fromNative(mintedRaw);
  const depositedBase = amountInRaw != null ? fromNative(amountInRaw) : null;

  let newZsdCirc = reserve.zsdCirc;
  let newZrsCirc = reserve.zrsCirc;
  let newZephReserve = reserve.zephInReserve;

  if (mintedToken === "ZSD.n") {
    newZsdCirc += mintedAmount;
    if (depositedBase != null) newZephReserve += depositedBase;
  } else if (mintedToken === "ZRS.n") {
    newZrsCirc += mintedAmount;
    if (depositedBase != null) newZephReserve += depositedBase;
  }

  const oldLiabilities = reserve.zsdCirc;
  const newLiabilities = mintedToken === "ZSD.n" ? newZsdCirc : reserve.zsdCirc;

  const zephSpotPrice = reserve.zephPriceUsd;
  const oldAssets = reserve.reserveRatio * oldLiabilities;
  const assetsDelta = depositedBase != null ? depositedBase * zephSpotPrice : mintedAmount * zephSpotPrice;
  const newAssets = oldAssets + assetsDelta;

  const newReserveRatio = newLiabilities === 0 ? reserve.reserveRatio : newAssets / newLiabilities;

  const zephMaPrice = reserve.rates.zeph.movingAverage ?? zephSpotPrice;
  const oldAssetsMa = reserve.reserveRatioMovingAverage * oldLiabilities;
  const assetsMaDelta = depositedBase != null ? depositedBase * zephMaPrice : mintedAmount * zephMaPrice;
  const newAssetsMa = oldAssetsMa + assetsMaDelta;
  const newReserveRatioMa = newLiabilities === 0 ? reserve.reserveRatioMovingAverage : newAssetsMa / newLiabilities;

  const metrics: NetworkEffectMetric[] = [];
  metrics.push(buildMetric("zephInReserve", "ZEPH Reserve", "token", reserve.zephInReserve, newZephReserve));
  if (mintedToken === "ZSD.n") {
    metrics.push(buildMetric("zsdCirc", "ZSD Circulating", "token", reserve.zsdCirc, newZsdCirc));
  }
  if (mintedToken === "ZRS.n") {
    metrics.push(buildMetric("zrsCirc", "ZRS Circulating", "token", reserve.zrsCirc, newZrsCirc));
  }
  metrics.push(buildMetric("reserveRatio", "Reserve Ratio", "ratio", reserve.reserveRatio, newReserveRatio));
  metrics.push(
    buildMetric(
      "reserveRatioMovingAverage",
      "Reserve Ratio (MA)",
      "ratio",
      reserve.reserveRatioMovingAverage,
      newReserveRatioMa,
    ),
  );

  const reserveRatioThresholdMin = 4;
  const reserveRatioThresholdMax = mintedToken === "ZRS.n" ? 8 : Number.POSITIVE_INFINITY;

  const allowed =
    newReserveRatio >= reserveRatioThresholdMin &&
    newReserveRatioMa >= reserveRatioThresholdMin &&
    newReserveRatio <= reserveRatioThresholdMax &&
    newReserveRatioMa <= reserveRatioThresholdMax;

  const reasons: string[] = [];
  if (newReserveRatio < reserveRatioThresholdMin || newReserveRatioMa < reserveRatioThresholdMin) {
    reasons.push("Reserve ratio would fall below 4× threshold");
  }
  if (newReserveRatio > reserveRatioThresholdMax || newReserveRatioMa > reserveRatioThresholdMax) {
    reasons.push("Reserve ratio would exceed 8× ceiling");
  }

  return {
    effect: {
      operation: request.op,
      metrics,
    },
    constraints: { allowed, reasons },
  };
}

function computeRedeemEffect(
  request: OperationQuoteRequest,
  response: OperationQuoteResponse,
  context: NativeOperationContext,
  reserve: ReserveState,
): NativeEffectResult {
  if (!response.amountOut) {
    return {
      effect: null,
      constraints: { allowed: false, reasons: ["Quote produced no output"] },
    };
  }
  const amountInRaw = request.amountIn ?? null;
  const burnedRaw = amountInRaw;
  const withdrawnZeph = fromNative(response.amountOut);

  const burnedToken = context.from;
  const burnedAmount = burnedRaw != null ? fromNative(burnedRaw) : null;

  let newZsdCirc = reserve.zsdCirc;
  let newZrsCirc = reserve.zrsCirc;
  let newZephReserve = reserve.zephInReserve;

  if (burnedToken === "ZSD.n" && burnedAmount != null) {
    newZsdCirc = Math.max(0, reserve.zsdCirc - burnedAmount);
    newZephReserve = Math.max(0, reserve.zephInReserve - withdrawnZeph);
  } else if (burnedToken === "ZRS.n" && burnedAmount != null) {
    newZrsCirc = Math.max(0, reserve.zrsCirc - burnedAmount);
    newZephReserve = Math.max(0, reserve.zephInReserve - withdrawnZeph);
  }

  const oldLiabilities = reserve.zsdCirc;
  const newLiabilities = burnedToken === "ZSD.n" && burnedAmount != null ? Math.max(0, reserve.zsdCirc - burnedAmount) : reserve.zsdCirc;

  const zephSpotPrice = reserve.zephPriceUsd;
  const oldAssets = reserve.reserveRatio * oldLiabilities;
  const assetsDelta = withdrawnZeph * zephSpotPrice;
  const newAssets = Math.max(0, oldAssets - assetsDelta);

  const newReserveRatio =
    newLiabilities === 0 ? reserve.reserveRatio : newAssets / newLiabilities || reserve.reserveRatio;

  const zephMaPrice = reserve.rates.zeph.movingAverage ?? zephSpotPrice;
  const oldAssetsMa = reserve.reserveRatioMovingAverage * oldLiabilities;
  const assetsMaDelta = withdrawnZeph * zephMaPrice;
  const newAssetsMa = Math.max(0, oldAssetsMa - assetsMaDelta);
  const newReserveRatioMa =
    newLiabilities === 0 ? reserve.reserveRatioMovingAverage : newAssetsMa / newLiabilities || reserve.reserveRatioMovingAverage;

  const metrics: NetworkEffectMetric[] = [];
  metrics.push(buildMetric("zephInReserve", "ZEPH Reserve", "token", reserve.zephInReserve, newZephReserve));
  if (burnedToken === "ZSD.n" && burnedAmount != null) {
    metrics.push(buildMetric("zsdCirc", "ZSD Circulating", "token", reserve.zsdCirc, newZsdCirc));
  }
  if (burnedToken === "ZRS.n" && burnedAmount != null) {
    metrics.push(buildMetric("zrsCirc", "ZRS Circulating", "token", reserve.zrsCirc, newZrsCirc));
  }
  metrics.push(buildMetric("reserveRatio", "Reserve Ratio", "ratio", reserve.reserveRatio, newReserveRatio));
  metrics.push(
    buildMetric(
      "reserveRatioMovingAverage",
      "Reserve Ratio (MA)",
      "ratio",
      reserve.reserveRatioMovingAverage,
      newReserveRatioMa,
    ),
  );

  let allowed = true;
  const reasons: string[] = [];

  if (burnedToken === "ZRS.n") {
    const minThreshold = 4;
    if (newReserveRatio < minThreshold || newReserveRatioMa < minThreshold) {
      allowed = false;
      reasons.push("Reserve ratio would fall below 4× threshold");
    }
  }

  return {
    effect: {
      operation: request.op,
      metrics,
    },
    constraints: { allowed, reasons },
  };
}

export function computeNativeNetworkEffect(
  request: OperationQuoteRequest,
  response: OperationQuoteResponse,
  context: NativeOperationContext,
  state: GlobalState,
): { effect: NetworkEffect | null; allowed: boolean; reasons: string[] } {
  const reserve: ReserveState | null = state.zephyr.reserve ?? null;
  if (!reserve) return { effect: null, allowed: false, reasons: ["Missing reserve snapshot"] };

  if (context.kind === "mint") {
    const result = computeMintEffect(request, response, context, reserve);
    return { effect: result.effect, allowed: result.constraints.allowed, reasons: result.constraints.reasons };
  }

  if (context.kind === "redeem") {
    const result = computeRedeemEffect(request, response, context, reserve);
    return { effect: result.effect, allowed: result.constraints.allowed, reasons: result.constraints.reasons };
  }

  return { effect: null, allowed: false, reasons: ["Unsupported native operation kind"] };
}
