// src/domain/arbitrage/edge.ts
import { FEES, MAX_POOL_SHARE } from "./constants";

export const toBps = (x: number) => Math.round(x * 10_000);
export const gasBps = (gasUsd: number, notionalUsd: number) => (notionalUsd > 0 ? (gasUsd / notionalUsd) * 10_000 : 9_999);

// Stable rail (USDT/WZSD ~ 1.0)
export function edgeStableRail(usdtPerWzsd: number, gasUsd: number, clipUsd: number): number {
  const gapBps = toBps(1 - usdtPerWzsd); // positive if WZSD>1 (premium)
  const costs = toBps(FEES.STABLE) + Math.max(0, Math.round(gasBps(gasUsd, clipUsd)));
  return gapBps - costs;
}

// ZEPH via CEX (compare EVM implied $ZEPH to CEX $ZEPH)
export function edgeZephCex(evmZephUsd: number, cexZephUsd: number, gasUsd: number, clipUsd: number): number {
  const gross = toBps((evmZephUsd - cexZephUsd) / cexZephUsd);
  const costs = toBps(FEES.WZEPH + FEES.STABLE + FEES.CEX) + Math.max(0, Math.round(gasBps(gasUsd, clipUsd)));
  return gross - costs;
}

// ZYS via native (compare EVM ZYS:ZSD to native ZYS:ZSD)
export function edgeZysBridge(evmZysPerZsd: number, nativeZysPerZsd: number, gasUsd: number, clipUsd: number): number {
  const gross = toBps((evmZysPerZsd - nativeZysPerZsd) / nativeZysPerZsd);
  const costs = toBps(FEES.WZYS + FEES.WRAP) + Math.max(0, Math.round(gasBps(gasUsd, clipUsd)));
  return gross - costs;
}

// Simple, safe clip picker
export function pickClip(
  maxPoolUsd: number,
  maxInvUsd: number | null | undefined,
  minTicketUsd = 500,
  maxShare = MAX_POOL_SHARE
): number {
  const inv = Number.isFinite(maxInvUsd ?? NaN) ? (maxInvUsd as number) : Number.POSITIVE_INFINITY;
  const cap = Math.max(0, Math.min(maxPoolUsd * maxShare, inv));
  return cap >= minTicketUsd ? cap : 0;
}
