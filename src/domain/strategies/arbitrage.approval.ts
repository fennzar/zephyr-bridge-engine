import { createLogger } from "@shared/logger";

import type { OperationPlan } from "./types";
import type { RRMode } from "./types";

const log = createLogger("Arb");

/**
 * Check if the spot/MA spread is acceptable for auto-execution.
 * Large spreads indicate recent price volatility that may hurt redemption rates.
 */
export function checkSpotMaSpread(plan: OperationPlan): { ok: boolean; reason: string } {
  const spreadBps = plan.spotMaSpreadBps ?? 0;
  const absSpread = Math.abs(spreadBps);
  const direction = plan.opportunity.direction;
  const asset = plan.opportunity.asset;

  // Thresholds for concern (in bps)
  const SPREAD_WARNING_BPS = 300; // 3%
  const SPREAD_BLOCK_BPS = 500;   // 5%

  if (absSpread >= SPREAD_BLOCK_BPS) {
    return {
      ok: false,
      reason: `Blocking auto-execute: spot/MA spread too wide (${spreadBps}bps > ${SPREAD_BLOCK_BPS}bps)`,
    };
  }

  // For native redemptions, we get MIN(spot, MA) - so if spot > MA we lose out
  // For native minting, we pay MAX(spot, MA) - so if spot < MA we pay more
  if (asset !== "ZSD" && asset !== "ZYS") {
    // ZEPH and ZRS redemptions are affected by spread
    if (direction === "evm_discount" && spreadBps > SPREAD_WARNING_BPS) {
      // We buy on EVM, unwrap, then do native conversion
      // Positive spread (spot > MA) means we get less on redemption
      return {
        ok: false,
        reason: `Blocking ${asset} evm_discount: positive spread (${spreadBps}bps) hurts redemption rate`,
      };
    }

    if (direction === "evm_premium" && spreadBps < -SPREAD_WARNING_BPS) {
      // We sell on EVM, need to replace inventory via native minting
      // Negative spread (spot < MA) means we pay more on minting
      return {
        ok: false,
        reason: `Blocking ${asset} evm_premium: negative spread (${spreadBps}bps) hurts mint rate`,
      };
    }
  }

  return { ok: true, reason: "" };
}

/**
 * RR mode-aware auto-execution logic per asset type.
 */
export function shouldAutoExecuteForRRMode(
  asset: string | undefined,
  rrMode: RRMode | undefined,
  plan: OperationPlan,
): boolean {
  if (!rrMode || !asset) return false;

  switch (rrMode) {
    case "normal":
      // Normal mode: all assets can auto-execute
      return true;

    case "defensive":
      // Defensive mode (RR 200-400%):
      // - ZEPH: Be cautious, prefer manual
      // - ZSD: Allow if profitable (no minting anyway, just trading existing)
      // - ZRS: Block (ZRS ops are locked in this RR range)
      // - ZYS: Allow (ZYS ops are always available)
      if (asset === "ZRS") {
        log.info("Blocking auto-execute for ZRS in defensive mode");
        return false;
      }
      if (asset === "ZEPH") {
        // Require higher profit threshold in defensive mode
        if (plan.opportunity.expectedPnl < 20) {
          log.info("Blocking auto-execute for ZEPH in defensive mode (low profit)");
          return false;
        }
      }
      return true;

    case "crisis":
      // Crisis mode (RR < 200%):
      // - Block most auto-execution, require manual approval
      // - Exception: ZYS redemptions still work
      if (asset === "ZYS" && plan.opportunity.direction === "evm_discount") {
        // ZYS buys on EVM can still work
        return true;
      }
      log.info("Blocking auto-execute in crisis mode");
      return false;

    default:
      return false;
  }
}
