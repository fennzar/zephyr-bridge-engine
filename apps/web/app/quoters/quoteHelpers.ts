import type {
  OperationQuoteResponse,
  NetworkEffect,
  NetworkEffectMetric,
  NetworkMetricFormat,
} from "@domain/quoting/types";
import type { QuoteExactInputSingleResult } from "@services/evm/uniswapV4/quoter";

export interface AmountDisplay {
  wei: string;
  decimal: string | null;
  decimals: number | undefined;
}

export interface RateDisplay {
  label: string;
  value: string;
}

export interface NetworkEffectDisplayMetric {
  label: string;
  delta: string;
  deltaPercent?: string | null;
  oldValue: string;
  newValue: string;
}

export interface NetworkEffectDisplay {
  operation: OperationQuoteResponse["request"]["op"];
  metrics: NetworkEffectDisplayMetric[];
}

export interface QuoteDisplay {
  request: {
    op: OperationQuoteResponse["request"]["op"];
    from: OperationQuoteResponse["request"]["from"];
    to: OperationQuoteResponse["request"]["to"];
    amountIn?: AmountDisplay;
    amountOutTarget?: AmountDisplay;
  };
  amounts: {
    grossAmountOut?: AmountDisplay;
    amountOut: AmountDisplay;
    feePaid?: AmountDisplay;
    feeAsset?: "from" | "to";
    estGasWei?: AmountDisplay;
  };
  rates?: RateDisplay[];
  warnings?: string[];
  networkEffect?: NetworkEffectDisplay;
  policy?: OperationQuoteResponse["policy"];
}

export interface QuoteComparison {
  deltaWei: string;
  deltaDecimal: string | null;
  percentDelta: number | null;
}

export function parseDecimalToUnits(value: string, decimals: number): { ok: true; value: bigint } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Amount is required." };

  const normalized = trimmed.replace(/,/g, "");
  const sign = normalized.startsWith("-");
  if (sign) return { ok: false, error: "Negative amounts are not supported." };

  const parts = normalized.split(".");
  if (parts.length > 2) {
    return { ok: false, error: "Invalid decimal format." };
  }

  const [wholePartRaw, fractionPartRaw = ""] = parts;
  if (!wholePartRaw && !fractionPartRaw) {
    return { ok: false, error: "Amount is required." };
  }
  if (!/^\d*$/.test(wholePartRaw) || !/^\d*$/.test(fractionPartRaw)) {
    return { ok: false, error: "Amount must be numeric." };
  }

  if (fractionPartRaw.length > decimals) {
    return {
      ok: false,
      error: `Amount exceeds allowed precision (${decimals} decimals).`,
    };
  }

  const wholePart = wholePartRaw.length > 0 ? wholePartRaw : "0";
  const fraction = fractionPartRaw.padEnd(decimals, "0");
  const digits = `${wholePart}${fraction}`;

  try {
    return { ok: true, value: BigInt(digits) };
  } catch {
    return { ok: false, error: "Amount is too large to parse." };
  }
}

export function buildQuoteDisplay({
  quote,
  fromDecimals,
  toDecimals,
  rates,
}: {
  quote: OperationQuoteResponse;
  fromDecimals: number | undefined;
  toDecimals: number | undefined;
  rates?: RateDisplay[];
}): QuoteDisplay {
  const amountInRaw = quote.request.amountIn;
  const amountOutTargetRaw = quote.request.amountOut;
  const amountInView =
    amountInRaw != null && fromDecimals != null ? formatAmount(amountInRaw, fromDecimals) : undefined;
  const amountOutTargetView =
    amountOutTargetRaw != null && toDecimals != null ? formatAmount(amountOutTargetRaw, toDecimals) : undefined;
  const amountOutView = formatAmount(quote.amountOut, toDecimals);
  const grossAmountOutView =
    quote.grossAmountOut != null ? formatAmount(quote.grossAmountOut, toDecimals) : undefined;
  const feeDecimals = quote.feeAsset === "to" ? toDecimals : fromDecimals;
  const feeView = quote.feePaid != null ? formatAmount(quote.feePaid, feeDecimals) : undefined;
  const gasView = quote.estGasWei != null ? formatAmount(quote.estGasWei, 18) : undefined;
  const networkEffectView = quote.networkEffect ? formatNetworkEffect(quote.networkEffect) : undefined;

  return {
    request: {
      ...quote.request,
      amountIn: amountInView,
      amountOutTarget: amountOutTargetView,
    },
    amounts: {
      grossAmountOut: grossAmountOutView,
      amountOut: amountOutView,
      feePaid: feeView,
      feeAsset: feeView ? quote.feeAsset : undefined,
      estGasWei: gasView,
    },
    rates,
    warnings: quote.warnings,
    networkEffect: networkEffectView,
    policy: quote.policy,
  };
}

export function formatAmount(value: bigint, decimals: number | undefined): AmountDisplay {
  return {
    wei: value.toString(),
    decimal: decimals != null ? formatUnits(value, decimals) : null,
    decimals,
  };
}

export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const str = abs.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const fraction = str.slice(-decimals).replace(/0+$/, "");
  const formatted = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${formatted}` : formatted;
}

export function compareQuotes(
  stateQuote: OperationQuoteResponse | null,
  onchainQuote: QuoteExactInputSingleResult | null,
  toDecimals: number | undefined,
): QuoteComparison | null {
  if (!stateQuote || !onchainQuote) return null;
  const delta = onchainQuote.amountOut - stateQuote.amountOut;
  const deltaView = formatAmount(delta, toDecimals);

  let percentDelta: number | null = null;
  const denominator = toSafeNumber(stateQuote.amountOut);
  const numerator = toSafeNumber(delta);
  if (denominator != null && numerator != null && denominator !== 0) {
    percentDelta = numerator / denominator;
  }

  return {
    deltaWei: delta.toString(),
    deltaDecimal: deltaView.decimal,
    percentDelta,
  };
}

function toSafeNumber(value: bigint): number | null {
  const abs = value >= 0 ? value : -value;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function formatNetworkNumber(value: number, format: NetworkMetricFormat): string {
  if (!Number.isFinite(value)) return "—";
  const options =
    format === "ratio"
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return value.toLocaleString("en-US", options);
}

function formatDeltaPercent(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}%`;
}

function formatNetworkEffect(effect: NetworkEffect): NetworkEffectDisplay {
  const metrics: NetworkEffectDisplayMetric[] = effect.metrics.map((metric: NetworkEffectMetric) => {
    return {
      label: metric.label,
      delta: `${metric.delta >= 0 ? "+" : ""}${formatNetworkNumber(metric.delta, metric.format)}`,
      deltaPercent: formatDeltaPercent(metric.deltaPercent),
      oldValue: formatNetworkNumber(metric.old, metric.format),
      newValue: formatNetworkNumber(metric.new, metric.format),
    };
  });

  return {
    operation: effect.operation,
    metrics,
  };
}
