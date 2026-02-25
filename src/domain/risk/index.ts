/**
 * Risk management module for the execution engine.
 *
 * All controls are DISABLED by default for testnet v2.
 * Enable via RISK_CONTROLS_ENABLED=true environment variable.
 */

export {
  type RiskLimits,
  type RiskCheckResult,
  DEFAULT_RISK_LIMITS,
  checkOperationAllowed,
  createRiskLimits,
} from "./limits";

export {
  type CircuitBreakerState,
  CircuitBreaker,
} from "./circuitBreaker";
