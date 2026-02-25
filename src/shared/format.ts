export function isFiniteNumber(value: unknown): value is number {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed);
  }
  return false;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function averageNonNull(...values: unknown[]): number | null {
  const finiteValues = values
    .map((value) => toFiniteNumber(value))
    .filter((value): value is number => value != null);
  if (finiteValues.length === 0) return null;
  const sum = finiteValues.reduce((acc, current) => acc + current, 0);
  return sum / finiteValues.length;
}

export function formatNumber(value: unknown, digits = 2): string {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatCurrency(value: unknown, digits = 2): string {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  return numeric.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

export function formatBps(value: unknown): string {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "—";
  return `${Math.round(numeric)} bps`;
}

export function formatToken(amount: unknown, symbol: string, digits = 4): string {
  const numeric = toFiniteNumber(amount);
  if (numeric == null) return `— ${symbol}`;
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: digits })} ${symbol}`;
}

export function formatRateWithUnitAndUsd(rate: unknown, unit: string, usd: unknown): string {
  const rateNumeric = toFiniteNumber(rate);
  const usdNumeric = toFiniteNumber(usd);
  if (rateNumeric == null || usdNumeric == null) return "—";
  return `${formatNumber(rateNumeric, 6)} ${unit} (${formatCurrency(usdNumeric)})`;
}

export function formatSignedRateWithUnit(delta: unknown, unit: string): string {
  const numeric = toFiniteNumber(delta);
  if (numeric == null) return `— ${unit}`;
  const sign = numeric >= 0 ? "+" : "";
  return `${sign}${formatNumber(numeric, 6)} ${unit}`;
}
