export const RATE_SCALE = 1_000_000_000_000n; // 1e12

export function toRatio(rate: number): bigint {
  // safe guard
  if (!Number.isFinite(rate) || rate <= 0) return 0n;
  return BigInt(Math.round(rate * Number(RATE_SCALE)));
}

// mulDiv(a * b / d) with floor, using bigint
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  return (a * b) / d;
}

// apply fee in bps: out * (10000 - fee) / 10000
export function applyBps(out: bigint, feeBps: number): bigint {
  const N = 10_000n;
  const fb = BigInt(Math.max(0, Math.min(10_000, Math.floor(feeBps))));
  return mulDiv(out, N - fb, N);
}
