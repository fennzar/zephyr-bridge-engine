import type { GlobalState } from "@domain/state";
import type { ArbLegs } from "@domain/arbitrage/routing";
import type { ArbMarketAnalysis } from "@domain/arbitrage/analysis";
import type { RRMode } from "./types";

/**
 * Result of analyzing a single arbitrage leg.
 */
export interface LegAnalysis {
  hasOpportunity: boolean;
  trigger: string;
  estimatedPnl: number;
  gapBps: number | null;
  nativeCloseAvailable: boolean;
  cexCloseAvailable: boolean;
}

/**
 * Analyze a single arb leg against current state and market data.
 */
export function analyzeLeg(
  leg: ArbLegs,
  state: GlobalState,
  rrMode: RRMode,
  market?: ArbMarketAnalysis,
): LegAnalysis {
  const reserve = state.zephyr?.reserve;
  if (!reserve) {
    return {
      hasOpportunity: false,
      trigger: "No reserve data",
      estimatedPnl: 0,
      gapBps: null,
      nativeCloseAvailable: false,
      cexCloseAvailable: false,
    };
  }

  const nativeCloseAvailable = isNativeCloseAvailable(leg, reserve);
  const cexCloseAvailable = leg.close.cex != null && state.cex != null;

  // Check if market analysis indicates an opportunity in this direction
  if (!market) {
    return {
      hasOpportunity: false,
      trigger: "No market data",
      estimatedPnl: 0,
      gapBps: null,
      nativeCloseAvailable,
      cexCloseAvailable,
    };
  }

  // Check if the market direction matches this leg's direction
  const marketMatchesLeg = market.direction === leg.direction;

  if (!marketMatchesLeg || !market.meetsTrigger) {
    return {
      hasOpportunity: false,
      trigger: market.direction === "aligned"
        ? `${leg.asset} aligned (gap: ${market.gapBps ?? 0}bps, threshold: ${market.triggerBps}bps)`
        : `Direction mismatch (market: ${market.direction}, leg: ${leg.direction})`,
      estimatedPnl: 0,
      gapBps: market.gapBps,
      nativeCloseAvailable,
      cexCloseAvailable,
    };
  }

  // We have a matching opportunity!
  // Check if we have a viable close path
  const hasClosePath = nativeCloseAvailable || cexCloseAvailable;

  if (!hasClosePath) {
    return {
      hasOpportunity: false,
      trigger: `${leg.asset} ${leg.direction} opportunity but no close path available (RR: ${rrMode})`,
      estimatedPnl: 0,
      gapBps: market.gapBps,
      nativeCloseAvailable,
      cexCloseAvailable,
    };
  }

  // Estimate P&L based on gap (rough estimate before fees)
  // Gap in bps means for every $100 traded, we make $gap/100
  const gapBps = Math.abs(market.gapBps ?? 0);
  const estimatedClipSize = 1000; // $1000 base clip for estimation
  const grossPnl = (gapBps / 10000) * estimatedClipSize;

  // Rough fee estimate
  const estimatedFeesValue = estimateFees(leg, state);
  const netPnl = grossPnl - estimatedFeesValue;

  const trigger = `${leg.asset} ${leg.direction}: gap=${market.gapBps}bps, ref=${market.reference.priceUsd?.toFixed(4)}, dex=${market.pricing.dex.priceUsd?.toFixed(4)}`;

  return {
    hasOpportunity: netPnl > 0,
    trigger,
    estimatedPnl: netPnl,
    gapBps: market.gapBps,
    nativeCloseAvailable,
    cexCloseAvailable,
  };
}

/**
 * Rough fee estimate for a leg.
 */
export function estimateFees(leg: ArbLegs, _state: GlobalState): number {
  let fees = 0;

  // EVM swap fee (0.30% for volatile, 0.03% for stable)
  const evmFeeBps = leg.asset === "ZSD" ? 3 : 30;
  fees += (evmFeeBps / 10000) * 1000;

  // Bridge fee if wrapping/unwrapping (1% on unwrap)
  fees += 10; // ~1% of $1000

  // Native conversion fee (0.1% for ZSD/ZYS, 1% for ZRS)
  const nativeFeeBps = leg.asset === "ZRS" ? 100 : 10;
  fees += (nativeFeeBps / 10000) * 1000;

  // CEX fee if using CEX close (0.1%)
  if (leg.close.cex != null) {
    fees += 1;
  }

  // Gas estimate
  fees += 5; // Rough gas cost

  return fees;
}

/**
 * Check if a native close path is available for the given leg based on reserve policy.
 */
export function isNativeCloseAvailable(
  leg: ArbLegs,
  reserve: NonNullable<GlobalState["zephyr"]>["reserve"],
): boolean {
  const policy = reserve.policy;

  switch (leg.asset) {
    case "ZEPH":
      if (leg.direction === "evm_discount") {
        return policy.zsd.mintable;
      } else {
        return policy.zsd.redeemable;
      }

    case "ZSD":
      return true;

    case "ZRS":
      if (leg.direction === "evm_discount") {
        return policy.zrs.redeemable;
      } else {
        return policy.zrs.mintable;
      }

    case "ZYS":
      return true;

    default:
      return false;
  }
}

/**
 * Determine urgency level based on estimated P&L and reserve ratio mode.
 */
export function determineUrgency(
  estimatedPnl: number,
  _rrMode: string,
): "low" | "medium" | "high" | "critical" {
  if (estimatedPnl > 100) return "high";
  if (estimatedPnl > 50) return "medium";
  return "low";
}
