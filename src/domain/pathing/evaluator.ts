import { findAssetPaths } from "@domain/inventory/graph";
import type { AssetPath, PathStep } from "@domain/inventory/graph";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import type { GlobalState } from "@domain/state/types";
import { quoteSwapState } from "@domain/quoting/quoting.state.swap";
import { quoteNativeOperation } from "@domain/quoting/quoting.zephyr";
import { quoteBridgeOperation } from "@domain/quoting/quoting.bridge";
import { quoteCexTrade } from "@domain/quoting/quoting.cex";
import type { OperationQuoteRequest, OperationQuoteResponse } from "@domain/quoting/types";
import type { AssetId, OpType } from "@domain/types";
import { assetDecimals } from "@domain/assets/decimals";
import { toDecimal } from "@domain/core/conversion";
import { env } from "@shared";

import type {
  InventoryBalances,
  PathAssetDelta,
  PathEvaluation,
  PathFeeSummary,
  PathHopEvaluation,
  PathInventorySummary,
  PathInventoryStatus,
  PathingQuoteRequest,
  PathingResult,
} from "./types";

const BPS_SCALE = 10_000n;
const GAS_TOKEN_USD_PRICE =
  typeof env.GAS_TOKEN_USD_PRICE === "number" && Number.isFinite(env.GAS_TOKEN_USD_PRICE)
    ? env.GAS_TOKEN_USD_PRICE
    : 2000;

function scaleAmountBetweenDecimals(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals > toDecimals) {
    const divisor = 10n ** BigInt(fromDecimals - toDecimals);
    return amount / divisor;
  }
  const multiplier = 10n ** BigInt(toDecimals - fromDecimals);
  return amount * multiplier;
}

type RuntimeContext =
  | SwapEvmContext
  | NativeOperationContext
  | BridgeOperationContext
  | CexOperationContext
  | null;

export async function evaluatePaths(request: PathingQuoteRequest, state: GlobalState): Promise<PathingResult> {
  const { from, to, maxDepth, limit, amountIn, inventory } = request;
  const assetPaths = findAssetPaths(from, to, maxDepth);
  const trimmed = typeof limit === "number" && limit > 0 ? assetPaths.slice(0, limit) : assetPaths;
  const evaluated: PathEvaluation[] = [];

  for (const path of trimmed) {
    evaluated.push(await evaluatePath(path, state, amountIn, inventory));
  }

  return {
    from,
    to,
    amountIn,
    maxDepth,
    evaluatedAt: Date.now(),
    paths: sortEvaluations(evaluated),
  };
}

export async function evaluatePath(
  path: AssetPath,
  state: GlobalState,
  amountIn: bigint,
  inventory?: InventoryBalances,
): Promise<PathEvaluation> {
  const hops: PathHopEvaluation[] = [];
  const assetTotals = new Map<AssetId, bigint>();
  const feeEntries: Array<{ asset: AssetId; amount: bigint }> = [];
  const priceMap = buildAssetUsdPriceMap(state);

  let cursor: bigint | null = amountIn;
  let finalAmountOut: bigint | null = null;
  let disallowed = 0;
  let feeSum = 0;
  let feeMissing = false;
  let totalGasWei: bigint | null = null;
  let totalGasUsd = 0;
  const notes: string[] = [];
  let totalDurationMs = 0;

  for (let index = 0; index < path.steps.length; index += 1) {
    const step = path.steps[index];

    const evaluation = await evaluateStep(step, state, cursor, index);
    hops.push(evaluation);

    if (!evaluation.allowed) disallowed += 1;
    if (evaluation.warnings.length > 0) appendUnique(notes, evaluation.warnings);
    if (evaluation.allowanceReasons.length > 0) appendUnique(notes, evaluation.allowanceReasons);

    if (evaluation.feeBps != null) {
      feeSum += evaluation.feeBps;
    } else {
      feeMissing = true;
    }

    if (evaluation.gasWei != null) {
      totalGasWei = (totalGasWei ?? 0n) + evaluation.gasWei;
    }
    if (evaluation.gasUsd != null) {
      totalGasUsd += evaluation.gasUsd;
    }

    if (evaluation.feePaid && evaluation.feeAssetId) {
      feeEntries.push({ asset: evaluation.feeAssetId, amount: evaluation.feePaid });
    }

    Object.entries(evaluation.assetDeltas).forEach(([assetKey, delta]) => {
      if (delta == null || delta === 0n) return;
      const asset = assetKey as AssetId;
      assetTotals.set(asset, (assetTotals.get(asset) ?? 0n) + delta);
    });

    if (evaluation.durationMs != null && Number.isFinite(evaluation.durationMs)) {
      totalDurationMs += evaluation.durationMs;
    }

    if (evaluation.amountOut != null) {
      finalAmountOut = evaluation.amountOut;
      cursor = evaluation.amountOut > 0n ? evaluation.amountOut : 0n;
    } else {
      cursor = null;
    }
  }

  for (const hop of hops) {
    if (hop.feePaid && hop.feeAssetId) {
      const decimals = assetDecimals(hop.feeAssetId);
      const amountDecimal = toDecimal(hop.feePaid, decimals);
      const usdPrice = priceMap[hop.feeAssetId] ?? null;
      hop.feeUsd = usdPrice != null ? amountDecimal * usdPrice : null;
    } else {
      hop.feeUsd = null;
    }
  }

  const assetDeltas: PathAssetDelta[] = [];
  let netUsdChange: number = 0;
  let hasUsdChange = false;
  const missingPriceAssets: AssetId[] = [];

  const pathAssets = Array.from(new Set(path.assets)) as AssetId[];
  for (const asset of pathAssets) {
    if (!assetTotals.has(asset)) {
      assetTotals.set(asset, 0n);
    }
  }

  assetTotals.forEach((delta, asset) => {
    const decimals = assetDecimals(asset);
    const decimalAmount = toDecimal(delta, decimals);
    const usdPrice = priceMap[asset] ?? null;
    const usdChange = usdPrice != null ? decimalAmount * usdPrice : null;
    if (usdChange != null) {
      hasUsdChange = true;
      netUsdChange += usdChange;
    } else if (decimalAmount !== 0) {
      missingPriceAssets.push(asset);
    }
    const startingBalance = inventory?.[asset] ?? null;
    const endingBalance = startingBalance != null ? startingBalance + decimalAmount : null;

    assetDeltas.push({
      asset,
      amount: delta,
      amountDecimal: decimalAmount,
      usdPrice,
      usdChange,
      startingBalance,
      endingBalance,
    });
  });

  assetDeltas.sort((a, b) => a.asset.localeCompare(b.asset));

  const feeBreakdown: PathFeeSummary[] = feeEntries.map(({ asset, amount }) => {
    const decimals = assetDecimals(asset);
    const amountDecimal = toDecimal(amount, decimals);
    const usdPrice = priceMap[asset] ?? null;
    const usdAmount = usdPrice != null ? amountDecimal * usdPrice : null;
    return {
      asset,
      amount,
      amountDecimal,
      usdPrice,
      usdAmount,
    };
  });

  const hasFeeUsd = feeBreakdown.some((entry) => entry.usdAmount != null);
  const totalFeeUsd = hasFeeUsd
    ? feeBreakdown.reduce((acc, entry) => (entry.usdAmount != null ? acc + entry.usdAmount : acc), 0)
    : null;

  if (missingPriceAssets.length > 0) {
    notes.push(
      `Missing USD price for: ${missingPriceAssets
        .map((asset) => asset)
        .join(", ")}`,
    );
  }

  const resolvedNetUsdChange = hasUsdChange ? netUsdChange : null;
  const totalCostUsd =
    resolvedNetUsdChange != null ? totalGasUsd - resolvedNetUsdChange : missingPriceAssets.length === 0 ? totalGasUsd : null;

  const inventorySummary = summarizeInventoryCoverage(assetDeltas, path.steps.length);

  const score = {
    allowed: disallowed === 0,
    disallowedSteps: disallowed,
    totalFeeBps: feeMissing ? null : feeSum,
    totalGasWei: totalGasWei ?? null,
    totalGasUsd,
    netUsdChangeUsd: resolvedNetUsdChange,
    totalCostUsd,
    totalDurationMs,
    hopCount: path.steps.length,
    inventoryStatus: inventorySummary.status,
  };

  return {
    path,
    hops,
    score,
    finalAmountOut,
    assetDeltas,
    feeBreakdown,
    totalFeeUsd,
    totalGasUsd,
    netUsdChangeUsd: resolvedNetUsdChange,
    totalCostUsd,
    totalDurationMs,
    notes,
    inventory: inventorySummary,
  };
}

async function evaluateStep(
  step: PathStep,
  state: GlobalState,
  amountIn: bigint | null,
  index: number,
): Promise<PathHopEvaluation> {
  const runtime = OP_RUNTIME[step.op] as OperationRuntime<RuntimeContext> | undefined;

  let runtimeEnabled: boolean | null = null;
  let runtimeContext: RuntimeContext = null;
  let runtimeContextAvailable = false;
  let durationMs: number | undefined;
  const allowanceReasons: string[] = [];
  const warnings: string[] = [];
  let allowed = true;

  if (runtime) {
    try {
    runtimeEnabled = runtime.enabled(step.from, step.to, state);
    durationMs = runtime.durationMs?.(step.from, step.to, state) ?? undefined;
    runtimeContext = runtime.buildContext(step.from, step.to, state) as RuntimeContext;
      runtimeContextAvailable = runtimeContext != null;
      if (!runtimeEnabled) {
        allowed = false;
        allowanceReasons.push("Runtime policy currently disables this operation");
      }
      if (!runtimeContextAvailable) {
        allowed = false;
        allowanceReasons.push("Runtime context unavailable");
      }
    } catch {
      runtimeEnabled = null;
      runtimeContextAvailable = false;
      allowed = false;
      allowanceReasons.push("Runtime evaluation threw an error");
    }
  } else {
    runtimeEnabled = null;
    runtimeContextAvailable = false;
    allowed = false;
    allowanceReasons.push("Runtime not registered for this operation");
  }

  const request = buildQuoteRequest(step.op, step.from, step.to, amountIn);
  let quote: OperationQuoteResponse | null = null;
  let amountOut: bigint | null = null;
  let feeBps: number | null = null;
  let gasWei: bigint | null = null;
  const assetDeltas: Partial<Record<AssetId, bigint>> = {};

  if (request && runtimeContextAvailable) {
    quote = await invokeQuoter(step.op, request, state, runtimeContext);
    if (quote) {
      if (quote.warnings) appendUnique(warnings, quote.warnings);
      const policy = extractPolicyAllowance(quote);
      if (!policy.allowed) {
        allowed = false;
        if (policy.reasons.length > 0) appendUnique(allowanceReasons, policy.reasons);
      }
      amountOut = quote.amountOut ?? null;
      feeBps = deriveFeeBps(quote, step.op, runtimeContext);
      gasWei = quote.estGasWei ?? null;
    } else {
      allowed = false;
      allowanceReasons.push("Quote unavailable for this operation");
    }
  } else if (!request) {
    allowed = false;
    allowanceReasons.push("Amount input unavailable for quote");
  }

  if (quote?.feePaid != null && quote.feePaid > 0n) {
    // if we have fee info but feeBps was not derived (e.g., fallback), recompute.
    const derived = deriveFeeBpsFromAmounts(quote.amountOut, quote.feePaid);
    if (derived != null) feeBps = derived;
  }

  if (feeBps == null) {
    feeBps = deriveContextualFeeBps(step.op, runtimeContext);
  }

  if (feeBps == null && quote?.feePaid == null && quote?.amountOut === 0n) {
    feeBps = 0;
  }

  const quotePayload = request && quote ? { request, response: quote } : undefined;
  if (amountIn != null) {
    addDelta(assetDeltas, step.from, -amountIn);
  }
  if (amountOut != null) {
    addDelta(assetDeltas, step.to, amountOut);
  }

  const feePaid = quote?.feePaid && quote.feePaid > 0n ? quote.feePaid : null;
  const feeAssetId =
    feePaid != null ? ((quote?.feeAsset === "to" ? step.to : step.from) as AssetId) : null;
  const gasUsd = estimateGasUsd(gasWei);

  return {
    index,
    op: step.op,
    from: step.from,
    to: step.to,
    runtimeEnabled,
    runtimeContextAvailable,
    durationMs,
    quote: quotePayload,
    amountIn,
    amountOut,
    feeBps,
    gasWei,
    gasUsd,
    feePaid,
    feeAssetId,
    assetDeltas,
    feeUsd: null,
    allowed,
    allowanceReasons,
    warnings,
  };
}

function buildQuoteRequest(op: OpType, from: AssetId, to: AssetId, amountIn: bigint | null): OperationQuoteRequest | null {
  if (!amountIn || amountIn <= 0n) return null;
  return { op, from, to, amountIn };
}

async function invokeQuoter(
  op: OpType,
  request: OperationQuoteRequest,
  state: GlobalState,
  context: RuntimeContext,
): Promise<OperationQuoteResponse | null> {
  switch (op) {
    case "swapEVM":
      return quoteSwapState(request, state);
    case "nativeMint":
    case "nativeRedeem":
      return quoteNativeOperation(request, state, { bypassAvailability: true });
    case "wrap":
    case "unwrap":
      return quoteBridgeOperation(request, state, context as BridgeOperationContext);
    case "tradeCEX":
      return quoteCexTrade(request, state, context as CexOperationContext);
    case "deposit":
      return quoteDeposit(request, state);
    case "withdraw":
      return quoteWithdraw(request, state);
    default:
      return null;
  }
}

function quoteDeposit(request: OperationQuoteRequest, state: GlobalState): OperationQuoteResponse | null {
  if (!state.cex) return null;
  const amountIn = request.amountIn ?? null;
  if (amountIn == null || amountIn <= 0n) return null;

  const fromDecimals = assetDecimals(request.from);
  const toDecimals = assetDecimals(request.to);
  const convertedAmount = scaleAmountBetweenDecimals(amountIn, fromDecimals, toDecimals);

  const warnings = [
    "Deposit quote uses placeholder 1:1 conversion; timing and fees pending detailed model",
  ];

  return {
    request,
    grossAmountOut: convertedAmount,
    amountOut: convertedAmount,
    warnings,
    policy: {
      cex: {
        allowed: true,
      },
    },
  };
}

function quoteWithdraw(request: OperationQuoteRequest, state: GlobalState): OperationQuoteResponse | null {
  if (!state.cex) return null;
  const amountIn = request.amountIn ?? null;
  if (amountIn == null || amountIn <= 0n) return null;

  const fee = withdrawalFeeFor(request.from, state);
  const gross = amountIn;
  const net = gross > fee ? gross - fee : 0n;
  const warnings: string[] = [];

  if (fee > 0n && gross <= fee) {
    warnings.push("Withdrawal fee exceeds amount");
  }

  if (fee === 0n) {
    warnings.push("Withdrawal fee model pending CEX fee configuration");
  }

  return {
    request,
    grossAmountOut: gross,
    amountOut: net,
    feePaid: fee > 0n ? fee : undefined,
    feeAsset: fee > 0n ? "from" : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    policy: {
      cex: {
        allowed: net > 0n,
        reasons: net > 0n ? undefined : ["Withdrawal amount depleted by fees"],
      },
    },
  };
}

function withdrawalFeeFor(asset: AssetId, state: GlobalState): bigint {
  if (!state.cex) return 0n;
  if (asset === "ZEPH.x") return state.cex.fees.zeph.withdrawal ?? 0n;
  if (asset === "USDT.x") return state.cex.fees.usdt.withdrawal ?? 0n;
  return 0n;
}

function deriveFeeBps(
  quote: OperationQuoteResponse | null,
  op: OpType,
  context: RuntimeContext,
): number | null {
  if (!quote) return null;
  if (quote.grossAmountOut != null && quote.grossAmountOut > 0n) {
    const fee = quote.grossAmountOut - quote.amountOut;
    return bigIntToBps(fee, quote.grossAmountOut);
  }

  if (quote.feePaid != null && quote.amountOut >= 0n) {
    const gross = quote.amountOut + quote.feePaid;
    if (gross > 0n) {
      return bigIntToBps(quote.feePaid, gross);
    }
  }

  return deriveContextualFeeBps(op, context);
}

function deriveFeeBpsFromAmounts(amountOut: bigint | null | undefined, feePaid: bigint): number | null {
  if (feePaid <= 0n) return 0;
  if (amountOut == null || amountOut < 0n) return null;
  const gross = amountOut + feePaid;
  if (gross <= 0n) return null;
  return bigIntToBps(feePaid, gross);
}

function deriveContextualFeeBps(op: OpType, context: RuntimeContext): number | null {
  if (!context) return null;
  switch (op) {
    case "swapEVM":
      return typeof (context as SwapEvmContext).pool?.feeBps === "number" ? (context as SwapEvmContext).pool.feeBps : null;
    case "nativeMint":
    case "nativeRedeem":
      return typeof (context as NativeOperationContext).feeBps === "number"
        ? (context as NativeOperationContext).feeBps
        : null;
    case "tradeCEX": {
      const ctx = context as CexOperationContext;
      const taker = ctx.cex?.fees?.takerBps;
      return typeof taker === "number" ? taker : null;
    }
    default:
      return null;
  }
}

function bigIntToBps(fee: bigint, base: bigint): number {
  if (fee <= 0n || base <= 0n) return 0;
  const scaled = (fee * BPS_SCALE) / base;
  return Number(scaled);
}

function extractPolicyAllowance(response: OperationQuoteResponse): { allowed: boolean; reasons: string[] } {
  let allowed = true;
  const reasons: string[] = [];

  const sections = [response.policy?.native, response.policy?.bridge, response.policy?.cex];
  for (const section of sections) {
    if (!section) continue;
    if (section.allowed === false) {
      allowed = false;
      if (section.reasons) appendUnique(reasons, section.reasons);
    }
  }

  return { allowed, reasons };
}

function appendUnique(target: string[], additions: string[] | undefined | null): void {
  if (!additions) return;
  for (const entry of additions) {
    if (!target.includes(entry)) target.push(entry);
  }
}

function sortEvaluations(paths: PathEvaluation[]): PathEvaluation[] {
  return [...paths].sort((a, b) => compareScores(a.score, b.score));
}

export function compareScores(a: PathEvaluation["score"], b: PathEvaluation["score"]): number {
  if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
  if (a.disallowedSteps !== b.disallowedSteps) return a.disallowedSteps - b.disallowedSteps;

  const inventoryRankDiff = inventoryStatusRank(a.inventoryStatus) - inventoryStatusRank(b.inventoryStatus);
  if (inventoryRankDiff !== 0) return inventoryRankDiff;

  if (a.hopCount !== b.hopCount) return a.hopCount - b.hopCount;

  if (
    a.totalCostUsd != null &&
    Number.isFinite(a.totalCostUsd) &&
    b.totalCostUsd != null &&
    Number.isFinite(b.totalCostUsd) &&
    a.totalCostUsd !== b.totalCostUsd
  ) {
    return a.totalCostUsd - b.totalCostUsd;
  }

  const feeA = a.totalFeeBps ?? Number.POSITIVE_INFINITY;
  const feeB = b.totalFeeBps ?? Number.POSITIVE_INFINITY;
  if (feeA !== feeB) return feeA - feeB;

  const gasA = a.totalGasWei ?? 0n;
  const gasB = b.totalGasWei ?? 0n;
  if (gasA !== gasB) return gasA < gasB ? -1 : 1;

  return 0;
}

function addDelta(target: Partial<Record<AssetId, bigint>>, asset: AssetId, delta: bigint): void {
  const current = target[asset] ?? 0n;
  target[asset] = current + delta;
}

function estimateGasUsd(gasWei: bigint | null | undefined): number {
  if (!gasWei || gasWei <= 0n) return 0;
  if (!Number.isFinite(GAS_TOKEN_USD_PRICE) || GAS_TOKEN_USD_PRICE <= 0) return 0;
  const ethAmount = Number(gasWei) / 1_000_000_000_000_000_000;
  if (!Number.isFinite(ethAmount)) return 0;
  return ethAmount * GAS_TOKEN_USD_PRICE;
}


function buildAssetUsdPriceMap(state: GlobalState): Partial<Record<AssetId, number>> {
  const prices: Partial<Record<AssetId, number>> = {
    "USDT.e": 1,
    "USDT.x": 1,
  };

  const reserve = state.zephyr?.reserve;
  if (reserve) {
    const zephUsd = reserve.zephPriceUsd;
    if (Number.isFinite(zephUsd)) {
      prices["WZEPH.e"] = zephUsd;
      prices["ZEPH.n"] = zephUsd;
      prices["ZEPH.x"] = zephUsd;
    }
    const zsdUsd = reserve.rates.zsd?.spotUSD;
    if (Number.isFinite(zsdUsd)) {
      prices["WZSD.e"] = zsdUsd;
      prices["ZSD.n"] = zsdUsd;
    }
    const zrsUsd = reserve.rates.zrs?.spotUSD;
    if (Number.isFinite(zrsUsd)) {
      prices["WZRS.e"] = zrsUsd;
      prices["ZRS.n"] = zrsUsd;
    }
    const zysUsd = reserve.rates.zys?.spotUSD;
    if (Number.isFinite(zysUsd)) {
      prices["WZYS.e"] = zysUsd;
      prices["ZYS.n"] = zysUsd;
    }
  }

  return prices;
}

function summarizeInventoryCoverage(
  deltas: PathAssetDelta[],
  hopCount: number,
): PathInventorySummary {
  const shortfalls = deltas
    .filter((delta) => delta.endingBalance != null && delta.endingBalance < -1e-9)
    .map((delta) => ({
      asset: delta.asset,
      shortfall: Math.abs(delta.endingBalance!),
      startingBalance: delta.startingBalance,
      endingBalance: delta.endingBalance,
    }));
  const hasUnknown = deltas.some(
    (delta) => delta.startingBalance == null || delta.endingBalance == null,
  );
  let status: PathInventoryStatus;
  if (shortfalls.length > 0) {
    status = "short";
  } else if (hopCount === 0 || deltas.length === 0) {
    status = "prepped";
  } else if (hasUnknown) {
    status = "unknown";
  } else {
    status = "covered";
  }
  return {
    status,
    shortfalls,
  };
}

function inventoryStatusRank(status: PathInventoryStatus): number {
  switch (status) {
    case "prepped":
      return 0;
    case "covered":
      return 1;
    case "unknown":
      return 2;
    case "short":
    default:
      return 3;
  }
}
