import { describe, it, expect } from "vitest";
import { ArbitrageStrategy } from "@domain/strategies/arbitrage";
import { buildTestPlan, buildTestConfig } from "../../support/factories";

const strategy = new ArbitrageStrategy();

describe("ArbitrageStrategy.shouldAutoExecute()", () => {
  const config = buildTestConfig();

  describe("normal mode", () => {
    it("auto-executes ZEPH with sufficient profit", () => {
      const plan = buildTestPlan({ asset: "ZEPH", rrMode: "normal", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
    it("auto-executes ZSD with sufficient profit", () => {
      const plan = buildTestPlan({ asset: "ZSD", rrMode: "normal", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
  });

  describe("blocks", () => {
    it("blocks when manualApproval is true", () => {
      const plan = buildTestPlan({ rrMode: "normal", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, buildTestConfig({ manualApproval: true }))).toBe(false);
    });
    it("blocks when pnl below minProfitUsd", () => {
      const plan = buildTestPlan({ rrMode: "normal", pnl: 0.5 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
  });

  describe("defensive mode", () => {
    it("blocks ZRS", () => {
      const plan = buildTestPlan({ asset: "ZRS", rrMode: "defensive", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks ZEPH with low profit (<$20)", () => {
      const plan = buildTestPlan({ asset: "ZEPH", rrMode: "defensive", pnl: 15 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("allows ZEPH with high profit (>=$20)", () => {
      const plan = buildTestPlan({ asset: "ZEPH", rrMode: "defensive", pnl: 25 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
    it("allows ZSD", () => {
      const plan = buildTestPlan({ asset: "ZSD", rrMode: "defensive", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
    it("allows ZYS", () => {
      const plan = buildTestPlan({ asset: "ZYS", rrMode: "defensive", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
  });

  describe("crisis mode", () => {
    it("allows only ZYS evm_discount", () => {
      const plan = buildTestPlan({ asset: "ZYS", direction: "evm_discount", rrMode: "crisis", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(true);
    });
    it("blocks ZYS evm_premium", () => {
      const plan = buildTestPlan({ asset: "ZYS", direction: "evm_premium", rrMode: "crisis", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks ZEPH", () => {
      const plan = buildTestPlan({ asset: "ZEPH", rrMode: "crisis", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks ZSD", () => {
      const plan = buildTestPlan({ asset: "ZSD", rrMode: "crisis", pnl: 50 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
  });

  describe("spot/MA spread", () => {
    it("blocks when spread >= 500bps", () => {
      const plan = buildTestPlan({ rrMode: "normal", pnl: 50, spreadBps: 500 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks when spread <= -500bps", () => {
      const plan = buildTestPlan({ rrMode: "normal", pnl: 50, spreadBps: -500 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks ZEPH evm_discount when positive spread > 300bps", () => {
      const plan = buildTestPlan({ asset: "ZEPH", direction: "evm_discount", rrMode: "normal", pnl: 50, spreadBps: 350 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
    it("blocks ZEPH evm_premium when negative spread < -300bps", () => {
      const plan = buildTestPlan({ asset: "ZEPH", direction: "evm_premium", rrMode: "normal", pnl: 50, spreadBps: -350 });
      expect(strategy.shouldAutoExecute(plan, config)).toBe(false);
    });
  });
});
