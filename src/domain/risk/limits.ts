/**
 * Risk limits module for testnet v2.
 *
 * Provides per-operation limits, rate limiting, and exposure caps.
 * All controls are DISABLED by default for dev/testing.
 */

export interface RiskLimits {
  /** Whether risk controls are enabled. Default: false for testnet. */
  enabled: boolean;
  /** Maximum USD value per single operation. */
  maxOperationUsd: number;
  /** Maximum cumulative daily loss before halting. */
  maxDailyLossUsd: number;
  /** Maximum consecutive failures before pausing. */
  maxConsecutiveFailures: number;
  /** Maximum exposure per asset as % of total inventory. */
  maxAssetExposurePct: number;
  /** Minimum time between operations on same leg (ms). */
  cooldownMs: number;
  /** Stale data threshold - block execution if data older than this (ms). */
  staleDataThresholdMs: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  enabled: false, // DISABLED by default for testnet v2
  maxOperationUsd: 1000,
  maxDailyLossUsd: 500,
  maxConsecutiveFailures: 3,
  maxAssetExposurePct: 30,
  cooldownMs: 60_000,
  staleDataThresholdMs: 60_000,
};

/**
 * Result of a risk check.
 */
export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  /** Original limits for reference. */
  limits: RiskLimits;
}

/**
 * Check if an operation is allowed under current risk limits.
 */
export function checkOperationAllowed(
  operationUsd: number,
  assetExposurePct: number,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): RiskCheckResult {
  // If risk controls are disabled, always allow
  if (!limits.enabled) {
    return { allowed: true, limits };
  }

  // Check operation size
  if (operationUsd > limits.maxOperationUsd) {
    return {
      allowed: false,
      reason: `Operation size $${operationUsd} exceeds limit $${limits.maxOperationUsd}`,
      limits,
    };
  }

  // Check asset exposure
  if (assetExposurePct > limits.maxAssetExposurePct) {
    return {
      allowed: false,
      reason: `Asset exposure ${assetExposurePct}% exceeds limit ${limits.maxAssetExposurePct}%`,
      limits,
    };
  }

  return { allowed: true, limits };
}

/**
 * Create risk limits from environment variables.
 */
export function createRiskLimits(overrides?: Partial<RiskLimits>): RiskLimits {
  const envEnabled = process.env.RISK_CONTROLS_ENABLED?.toLowerCase() === "true";

  return {
    ...DEFAULT_RISK_LIMITS,
    enabled: envEnabled,
    ...overrides,
  };
}
