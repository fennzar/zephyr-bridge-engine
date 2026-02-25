/**
 * Shared numeric ↔ bigint conversion utilities.
 *
 * Used across arbitrage, quoting, and pathing modules to convert between
 * human-readable decimal amounts and on-chain atomic (bigint) representations.
 */

export function decimalToBigInt(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const clamped = Math.min(Math.max(decimals, 0), 20);
  const fixed = amount.toFixed(clamped);
  const normalized = fixed.replace(".", "");
  let result = 0n;
  try {
    result = BigInt(normalized);
  } catch {
    return 0n;
  }
  if (decimals > clamped) {
    result *= 10n ** BigInt(decimals - clamped);
  }
  return result;
}

export function toDecimal(raw: bigint, decimals: number): number {
  if (raw === 0n) return 0;
  const scale = 10 ** decimals;
  return Number(raw) / scale;
}
