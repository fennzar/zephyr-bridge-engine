/**
 * Pool seeding service — orchestrates the full flow from wrapping native
 * assets to placing initial LP positions.  Replaces the Forge-based
 * `scripts/seed-devnet.sh` + `02_AddLiquidityFromJson.s.sol` pipeline.
 */

import { getAddress } from "viem";
import { createLogger } from "@shared/logger";
import type { NetworkEnv } from "@shared";

import {
  getNetworkConfig,
  type PoolPlanConfig,
  type TokenEntry,
} from "./config";
import type { EvmExecutor, LpPoolKey } from "./executor";
import {
  priceToSqrtPriceX96,
  computeTickBounds,
  getSqrtPriceAtTick,
  getLiquidityForAmounts,
  getAmountsForLiquidity,
} from "./uniswapV4/liquidityMath";

import type { BridgeExecutor } from "../bridge/executor";
import type { BridgeApiClient } from "../bridge/apiClient";
import type { ZephyrWalletClient } from "../zephyr/wallet";

const log = createLogger("PoolSeeder");

// ── Result types ──────────────────────────────────────────────────────────────

export interface WrapResult {
  asset: string;
  amount: bigint;
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface ClaimResult {
  claimId: string;
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface PositionResult {
  bandIndex: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  tokenId?: bigint;
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface PoolSeedResult {
  poolId: string;
  base: string;
  quote: string;
  positions: PositionResult[];
  success: boolean;
}

export interface SeedResult {
  wraps: WrapResult[];
  claims: ClaimResult[];
  pools: PoolSeedResult[];
  success: boolean;
}

export interface SeedConfig {
  wrapAmounts: Record<string, bigint>;
  poolPlans: PoolPlanConfig[];
}

// ── Dry-run plan types ────────────────────────────────────────────────────────

export interface DryRunPosition {
  bandIndex: number;
  pct: number;
  bandBps: number;
  tickLower: number;
  tickUpper: number;
  budgetQuote: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

export interface DryRunPool {
  base: string;
  quote: string;
  price: string;
  tickSpacing: number;
  positions: DryRunPosition[];
}

export interface DryRunPlan {
  wrapAmounts: Record<string, string>;
  pools: DryRunPool[];
}

// ── PoolSeeder ────────────────────────────────────────────────────────────────

export class PoolSeeder {
  constructor(
    private evmExecutor: EvmExecutor,
    private bridgeExecutor: BridgeExecutor,
    private bridgeApiClient: BridgeApiClient,
    private zephyrWallet: ZephyrWalletClient,
    private network: NetworkEnv,
  ) {}

  /**
   * Full seed flow: wrap → claim → LP.
   */
  async seedAll(
    config: SeedConfig,
    options?: { skipWrap?: boolean },
  ): Promise<SeedResult> {
    const result: SeedResult = {
      wraps: [],
      claims: [],
      pools: [],
      success: false,
    };

    // Step 1: Wrap native assets via bridge
    if (!options?.skipWrap) {
      log.info("Step 1: Wrapping native assets...");
      result.wraps = await this.wrapAssets(config.wrapAmounts);
      const wrapFailures = result.wraps.filter((w) => !w.success);
      if (wrapFailures.length > 0) {
        log.error(
          `${wrapFailures.length} wrap(s) failed: ${wrapFailures.map((w) => `${w.asset}: ${w.error}`).join(", ")}`,
        );
        return result;
      }

      // Step 2: Wait for claims and claim wrapped tokens
      log.info("Step 2: Waiting for bridge claims...");
      result.claims = await this.claimWrappedTokens(
        Object.keys(config.wrapAmounts).length,
      );
      const claimFailures = result.claims.filter((c) => !c.success);
      if (claimFailures.length > 0) {
        log.error(
          `${claimFailures.length} claim(s) failed: ${claimFailures.map((c) => `${c.claimId}: ${c.error}`).join(", ")}`,
        );
        return result;
      }
    } else {
      log.info("Skipping wrap/claim (--skip-wrap)");
    }

    // Step 3: Seed pools
    log.info("Step 3: Seeding pools...");
    result.pools = await this.seedPools(config.poolPlans);

    result.success = result.pools.every((p) => p.success);
    log.info(
      `Seeding ${result.success ? "completed" : "completed with errors"}: ${result.pools.filter((p) => p.success).length}/${result.pools.length} pools`,
    );

    return result;
  }

  /**
   * Trigger a pool scan via the bridge API.
   */
  async scanPools(adminToken?: string): Promise<void> {
    log.info("Scanning pools via bridge API...");
    try {
      const result = await this.bridgeApiClient.scanPools(adminToken);
      const pools = (result as { pools?: unknown[] }).pools ?? [];
      log.info(`Pool scan complete: ${pools.length} pools discovered`);
    } catch (err) {
      log.warn(`Pool scan failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Wrap native assets via bridge.
   */
  async wrapAssets(amounts: Record<string, bigint>): Promise<WrapResult[]> {
    const results: WrapResult[] = [];
    const evmAddress = this.evmExecutor.address;

    // Get or create bridge subaddress for this EVM address
    let bridgeSubaddress: string;
    log.info(`Creating bridge account for ${evmAddress}...`);
    try {
      bridgeSubaddress = await this.bridgeApiClient.createBridgeAccount(evmAddress);
      log.info(`Bridge subaddress: ${bridgeSubaddress.slice(0, 20)}...`);
    } catch (err) {
      log.error(`Bridge account creation failed: ${err instanceof Error ? err.message : err}`);
      // Cannot proceed without a subaddress
      for (const [asset, amount] of Object.entries(amounts)) {
        results.push({ asset, amount, success: false, error: "No bridge subaddress" });
      }
      return results;
    }

    // Send each asset to the bridge subaddress (no payment_id needed)
    for (const [asset, amount] of Object.entries(amounts)) {
      log.info(
        `Wrapping ${asset}: ${amount} atomic units to ${evmAddress}`,
      );
      try {
        const txResult = await this.zephyrWallet.transfer({
          address: bridgeSubaddress,
          amount,
          assetType: asset as "ZEPH" | "ZSD" | "ZRS" | "ZYS",
        });
        results.push({
          asset,
          amount,
          success: txResult.success,
          txHash: txResult.txHash,
          error: txResult.error,
        });
      } catch (err) {
        results.push({
          asset,
          amount,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Wait for bridge claims and claim wrapped tokens on EVM via claimWithSignature.
   */
  async claimWrappedTokens(expectedCount: number): Promise<ClaimResult[]> {
    const results: ClaimResult[] = [];
    const evmAddress = this.evmExecutor.address;

    const claims = await this.bridgeApiClient.waitForClaims(
      evmAddress,
      expectedCount,
    );

    for (const claim of claims) {
      log.info(`Claiming ${claim.asset} (${claim.id}) via claimWithSignature...`);
      try {
        const result = await this.evmExecutor.claimWithSignature({
          tokenAddress: claim.token,
          to: claim.to,
          amountWei: BigInt(claim.amountWei),
          zephTxId: claim.zephTxId,
          deadline: BigInt(claim.deadline),
          signature: claim.signature,
        });
        if (!result.success) {
          results.push({
            claimId: claim.id,
            success: false,
            error: result.error ?? "claimWithSignature failed",
          });
        } else {
          results.push({ claimId: claim.id, success: true, txHash: result.txHash });
        }
      } catch (err) {
        results.push({
          claimId: claim.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Seed all pools from plans.
   */
  async seedPools(plans: PoolPlanConfig[]): Promise<PoolSeedResult[]> {
    const results: PoolSeedResult[] = [];
    for (const plan of plans) {
      log.info(
        `Seeding pool ${plan.pricing.base}/${plan.pricing.quote} @ ${plan.pricing.price}...`,
      );
      const result = await this.seedPool(plan);
      results.push(result);
    }
    return results;
  }

  /**
   * Seed a single pool with its position bands.
   */
  async seedPool(plan: PoolPlanConfig): Promise<PoolSeedResult> {
    const config = getNetworkConfig(this.network);
    const positions: PositionResult[] = [];
    const poolId = `${plan.pricing.base}-${plan.pricing.quote}`;

    try {
      // Resolve token addresses
      const token0Entry = this.resolveToken(config.tokens, plan.key.tokenA);
      const token1Entry = this.resolveToken(config.tokens, plan.key.tokenB);
      if (!token0Entry || !token1Entry) {
        return {
          poolId,
          base: plan.pricing.base,
          quote: plan.pricing.quote,
          positions: [],
          success: false,
        };
      }

      // Sort tokens for pool key (currency0 < currency1)
      const [sorted0, sorted1] =
        token0Entry.address.toLowerCase() < token1Entry.address.toLowerCase()
          ? [token0Entry, token1Entry]
          : [token1Entry, token0Entry];

      const poolKey: LpPoolKey = {
        currency0: getAddress(sorted0.address),
        currency1: getAddress(sorted1.address),
        fee: plan.key.fee,
        tickSpacing: plan.key.tickSpacing,
        hooks: getAddress(plan.key.hooks),
      };

      const price = parseFloat(plan.pricing.price);
      const totalQuote = parseFloat(plan.budget.totalQuoteHuman);
      const quoteToken = this.resolveToken(
        config.tokens,
        plan.budget.quoteSymbol,
      );
      const quoteDecimals = quoteToken?.decimals ?? 12;

      // Determine if base is token0 or token1 for price direction
      const baseToken = this.resolveToken(config.tokens, plan.pricing.base);
      const baseIsToken0 =
        baseToken?.address.toLowerCase() === sorted0.address.toLowerCase();

      // Price in token1/token0 human terms (what Uniswap V4 expects)
      const priceFort1t0 = baseIsToken0 ? price : 1 / price;

      for (let i = 0; i < plan.budget.positions.length; i++) {
        const pos = plan.budget.positions[i]!;
        const bandBudget = (totalQuote * pos.pct) / 100;

        // Compute tick bounds
        const { tickLower, tickUpper } = computeTickBounds(
          priceFort1t0,
          pos.bandBps,
          plan.key.tickSpacing,
          sorted0.decimals,
          sorted1.decimals,
        );

        const sqrtPriceX96 = priceToSqrtPriceX96(
          priceFort1t0,
          sorted0.decimals,
          sorted1.decimals,
        );
        const sqrtLower = getSqrtPriceAtTick(tickLower);
        const sqrtUpper = getSqrtPriceAtTick(tickUpper);

        // Convert budget to token amounts
        const budgetAtomic = BigInt(
          Math.floor(bandBudget * Math.pow(10, quoteDecimals)),
        );
        const quoteIsToken1 =
          quoteToken?.address.toLowerCase() === sorted1.address.toLowerCase();

        // Scale budget between tokens accounting for different decimals.
        // price = token1_human / token0_human (priceFort1t0)
        const PRICE_SCALE = 1_000_000_000_000n; // 1e12 precision
        const priceBig = BigInt(Math.round(priceFort1t0 * 1e12));

        let amount0: bigint;
        let amount1: bigint;

        if (quoteIsToken1) {
          // Budget is in token1 atomic. Derive token0: amount0 = budget / price * 10^(d0-d1)
          amount1 = budgetAtomic;
          const decShift = sorted0.decimals - sorted1.decimals;
          if (decShift >= 0) {
            amount0 = (budgetAtomic * BigInt(10 ** decShift) * PRICE_SCALE) / priceBig;
          } else {
            amount0 = (budgetAtomic * PRICE_SCALE) / (priceBig * BigInt(10 ** -decShift));
          }
        } else {
          // Budget is in token0 atomic. Derive token1: amount1 = budget * price * 10^(d1-d0)
          amount0 = budgetAtomic;
          const decShift = sorted1.decimals - sorted0.decimals;
          if (decShift >= 0) {
            amount1 = (budgetAtomic * priceBig * BigInt(10 ** decShift)) / PRICE_SCALE;
          } else {
            amount1 = (budgetAtomic * priceBig) / (PRICE_SCALE * BigInt(10 ** -decShift));
          }
        }

        const liquidity = getLiquidityForAmounts(
          sqrtPriceX96,
          sqrtLower,
          sqrtUpper,
          amount0,
          amount1,
        );

        if (liquidity <= 0n) {
          log.warn(`Band ${i}: zero liquidity, skipping`);
          positions.push({
            bandIndex: i,
            tickLower,
            tickUpper,
            liquidity: 0n,
            amount0: 0n,
            amount1: 0n,
            success: false,
            error: "Computed liquidity is zero",
          });
          continue;
        }

        // Get actual amounts for the computed liquidity
        const amounts = getAmountsForLiquidity(
          sqrtPriceX96,
          sqrtLower,
          sqrtUpper,
          liquidity,
        );

        // Apply 2% slippage buffer on max amounts
        const slippageMultiplier = 102n;
        const amount0Max = (amounts.amount0 * slippageMultiplier) / 100n;
        const amount1Max = (amounts.amount1 * slippageMultiplier) / 100n;

        log.info(
          `  Band ${i}: ticks [${tickLower}, ${tickUpper}], ` +
            `liquidity=${liquidity}, amounts=[${amounts.amount0}, ${amounts.amount1}]`,
        );

        try {
          const result = await this.evmExecutor.executeLpMint({
            poolKey,
            tickLower,
            tickUpper,
            liquidity,
            amount0Max,
            amount1Max,
            slippageBps: 200,
          });

          positions.push({
            bandIndex: i,
            tickLower,
            tickUpper,
            liquidity,
            amount0: amounts.amount0,
            amount1: amounts.amount1,
            tokenId: result.tokenId,
            success: result.success,
            txHash: result.txHash,
            error: result.error,
          });
        } catch (err) {
          positions.push({
            bandIndex: i,
            tickLower,
            tickUpper,
            liquidity,
            amount0: amounts.amount0,
            amount1: amounts.amount1,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      log.error(`Failed to seed pool ${poolId}: ${err}`);
      return {
        poolId,
        base: plan.pricing.base,
        quote: plan.pricing.quote,
        positions,
        success: false,
      };
    }

    const allOk = positions.length > 0 && positions.every((p) => p.success);
    return {
      poolId,
      base: plan.pricing.base,
      quote: plan.pricing.quote,
      positions,
      success: allOk,
    };
  }

  /**
   * Generate a dry-run plan without executing anything.
   */
  dryRun(config: SeedConfig): DryRunPlan {
    const netConfig = getNetworkConfig(this.network);
    const pools: DryRunPool[] = [];

    for (const plan of config.poolPlans) {
      const token0Entry = this.resolveToken(netConfig.tokens, plan.key.tokenA);
      const token1Entry = this.resolveToken(netConfig.tokens, plan.key.tokenB);
      if (!token0Entry || !token1Entry) continue;

      const [sorted0, sorted1] =
        token0Entry.address.toLowerCase() < token1Entry.address.toLowerCase()
          ? [token0Entry, token1Entry]
          : [token1Entry, token0Entry];

      const price = parseFloat(plan.pricing.price);
      const totalQuote = parseFloat(plan.budget.totalQuoteHuman);

      const baseToken = this.resolveToken(netConfig.tokens, plan.pricing.base);
      const baseIsToken0 =
        baseToken?.address.toLowerCase() === sorted0.address.toLowerCase();
      const priceFort1t0 = baseIsToken0 ? price : 1 / price;

      const dryPositions: DryRunPosition[] = [];
      for (let i = 0; i < plan.budget.positions.length; i++) {
        const pos = plan.budget.positions[i]!;
        const bandBudget = (totalQuote * pos.pct) / 100;
        const { tickLower, tickUpper } = computeTickBounds(
          priceFort1t0,
          pos.bandBps,
          plan.key.tickSpacing,
          sorted0.decimals,
          sorted1.decimals,
        );

        dryPositions.push({
          bandIndex: i,
          pct: pos.pct,
          bandBps: pos.bandBps,
          tickLower,
          tickUpper,
          budgetQuote: bandBudget.toFixed(2),
          liquidity: "(computed at execution)",
          amount0: "(computed at execution)",
          amount1: "(computed at execution)",
        });
      }

      pools.push({
        base: plan.pricing.base,
        quote: plan.pricing.quote,
        price: plan.pricing.price,
        tickSpacing: plan.key.tickSpacing,
        positions: dryPositions,
      });
    }

    const wrapAmounts: Record<string, string> = {};
    for (const [asset, amount] of Object.entries(config.wrapAmounts)) {
      wrapAmounts[asset] = `${amount} atomic (${Number(amount) / 1e12} human)`;
    }

    return { wrapAmounts, pools };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private resolveToken(
    tokens: Record<string, TokenEntry>,
    symbolOrKey: string,
  ): (TokenEntry & { key: string }) | null {
    // Try direct key lookup
    if (tokens[symbolOrKey]) {
      return { ...tokens[symbolOrKey], key: symbolOrKey };
    }
    // Try by symbol match
    for (const [key, entry] of Object.entries(tokens)) {
      if (
        entry.symbol.toUpperCase() === symbolOrKey.toUpperCase() ||
        key.toUpperCase() === symbolOrKey.toUpperCase()
      ) {
        return { ...entry, key };
      }
    }
    log.error(`Token not found: ${symbolOrKey}`);
    return null;
  }
}
