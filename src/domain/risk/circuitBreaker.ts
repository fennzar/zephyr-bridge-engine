/**
 * Circuit breaker for execution engine.
 *
 * Monitors cumulative loss and failure rates to automatically
 * halt execution when thresholds are exceeded.
 *
 * DISABLED by default for testnet v2.
 */

import { createLogger } from "@shared/logger";

import type { RiskLimits, DEFAULT_RISK_LIMITS } from "./limits";

const log = createLogger("CircuitBreaker");

export interface CircuitBreakerState {
  /** Whether the circuit is currently open (halted). */
  isOpen: boolean;
  /** Reason for opening the circuit. */
  openReason?: string;
  /** When the circuit was opened. */
  openedAt?: Date;
  /** Cumulative loss since last reset (USD). */
  cumulativeLossUsd: number;
  /** Consecutive failure count. */
  consecutiveFailures: number;
  /** Total operations attempted. */
  totalOperations: number;
  /** Total successful operations. */
  successfulOperations: number;
  /** Last operation timestamp. */
  lastOperationAt?: Date;
}

const initialState: CircuitBreakerState = {
  isOpen: false,
  cumulativeLossUsd: 0,
  consecutiveFailures: 0,
  totalOperations: 0,
  successfulOperations: 0,
};

/**
 * In-memory circuit breaker.
 * For production, this should be backed by persistent storage.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = { ...initialState };
  private limits: RiskLimits;

  constructor(limits: RiskLimits) {
    this.limits = limits;
  }

  /**
   * Check if execution is allowed.
   */
  canExecute(): { allowed: boolean; reason?: string } {
    // If risk controls are disabled, always allow
    if (!this.limits.enabled) {
      return { allowed: true };
    }

    if (this.state.isOpen) {
      return {
        allowed: false,
        reason: this.state.openReason ?? "Circuit breaker is open",
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful operation.
   */
  recordSuccess(pnlUsd: number): void {
    this.state.totalOperations++;
    this.state.successfulOperations++;
    this.state.consecutiveFailures = 0;
    this.state.lastOperationAt = new Date();

    if (pnlUsd < 0) {
      this.state.cumulativeLossUsd += Math.abs(pnlUsd);
      this.checkThresholds();
    }
  }

  /**
   * Record a failed operation.
   */
  recordFailure(error?: string): void {
    this.state.totalOperations++;
    this.state.consecutiveFailures++;
    this.state.lastOperationAt = new Date();

    this.checkThresholds();
  }

  /**
   * Check if thresholds are exceeded and open circuit if needed.
   */
  private checkThresholds(): void {
    if (!this.limits.enabled) return;

    // Check consecutive failures
    if (this.state.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
      this.openCircuit(
        `Too many consecutive failures: ${this.state.consecutiveFailures}`
      );
      return;
    }

    // Check cumulative loss
    if (this.state.cumulativeLossUsd >= this.limits.maxDailyLossUsd) {
      this.openCircuit(
        `Daily loss limit exceeded: $${this.state.cumulativeLossUsd.toFixed(2)}`
      );
      return;
    }
  }

  /**
   * Open the circuit breaker.
   */
  private openCircuit(reason: string): void {
    this.state.isOpen = true;
    this.state.openReason = reason;
    this.state.openedAt = new Date();
    log.error(`Circuit OPENED: ${reason}`);
  }

  /**
   * Manually reset the circuit breaker.
   */
  reset(): void {
    log.info("Circuit reset");
    this.state = { ...initialState };
  }

  /**
   * Get current state (for monitoring).
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Reset daily counters (call at start of each day).
   */
  resetDaily(): void {
    this.state.cumulativeLossUsd = 0;
    if (this.state.isOpen && this.state.openReason?.includes("Daily loss")) {
      this.reset();
    }
  }
}
