import { createLogger } from "@shared/logger";

import type {
  ExecutionStep,
  ExecutionContext,
  VenueExecutors,
} from "./types";
import { applyDelay, type TimingDelays } from "./timing";
import { getTradeSymbol, getTradeSide, getWithdrawDestination } from "./execution.mapping";

const log = createLogger("Execution");

/**
 * Result from dispatching a step to its venue.
 */
export interface DispatchResult {
  success: boolean;
  amountOut?: bigint;
  txHash?: string;
  orderId?: string;
  error?: string;
  gasUsed?: bigint;
  feePaid?: bigint;
}

/**
 * Dispatch an execution step to the appropriate venue handler.
 */
export async function dispatchToVenue(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  switch (step.op) {
    case "swapEVM":
      return executeEvmSwap(step, executors, context);

    case "tradeCEX":
      return executeCexTrade(step, executors, context);

    case "nativeMint":
      return executeNativeMint(step, executors, context);

    case "nativeRedeem":
      return executeNativeRedeem(step, executors, context);

    case "wrap":
      return executeWrap(step, executors, context);

    case "unwrap":
      return executeUnwrap(step, executors, context);

    case "deposit":
      return executeCexDeposit(step, executors, context);

    case "withdraw":
      return executeCexWithdraw(step, executors, context);

    // LP operations
    case "lpMint":
      return executeLpMint(step, executors, context);

    case "lpBurn":
      return executeLpBurn(step, executors, context);

    case "lpCollect":
      return executeLpCollect(step, executors, context);

    default:
      return {
        success: false,
        error: `Unknown operation type: ${step.op}`,
      };
  }
}

async function executeEvmSwap(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  // Paper mode simulation
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating EVM swap ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("evmConfirmation");
    }
    // Simulate ~0.3% slippage
    const slippageFactor = 0.997;
    const simulatedOut = BigInt(Math.floor(Number(step.amountIn) * slippageFactor));
    return {
      success: true,
      txHash: `0xpaper_swap_${Date.now().toString(16)}`,
      amountOut: step.expectedAmountOut ?? simulatedOut,
    };
  }

  // Live mode: require swap context
  if (!step.swapContext) {
    return { success: false, error: "EVM swap requires swapContext (poolAddress, tokens, fee)" };
  }

  try {
    const result = await executors.evm.executeSwap({
      fromAsset: step.from,
      toAsset: step.to,
      amountIn: step.amountIn,
      amountOutMin: step.expectedAmountOut ?? 0n,
      pool: {
        key: `${step.from}-${step.to}`,
        base: step.from,
        quote: step.to,
        feeBps: step.swapContext.fee / 100, // Uniswap fee units -> bps
        baseDecimals: 18,
        quoteDecimals: 18,
        address: step.swapContext.poolAddress,
        sqrtPriceX96: step.swapContext.sqrtPriceLimitX96 ?? null,
      },
    });
    return {
      success: result.success,
      txHash: result.txHash,
      amountOut: result.amountOut,
      error: result.error,
      gasUsed: result.gasUsed,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "EVM swap failed" };
  }
}

async function executeCexTrade(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating CEX trade ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("cexTrade");
    }
    const slippageFactor = 0.999;
    const simulatedOut = BigInt(Math.floor(Number(step.amountIn) * slippageFactor));
    return {
      success: true,
      orderId: `paper_cex_${Date.now().toString(16)}`,
      amountOut: step.expectedAmountOut ?? simulatedOut,
      feePaid: BigInt(Math.floor(Number(step.amountIn) * 0.001)),
    };
  }

  const symbol = getTradeSymbol(step.from, step.to);
  const side = getTradeSide(step.from, step.to);
  const quantity = Number(step.amountIn) / 1e12; // Assuming 12 decimals

  const result = await executors.mexc.marketOrder({
    symbol,
    side,
    quantity,
  });

  if (context.simulateTiming) {
    await applyDelay("cexTrade");
  }

  return {
    success: result.success,
    amountOut: result.success ? BigInt(Math.floor(result.executedQty * 1e12)) : undefined,
    orderId: result.orderId,
    error: result.error,
    feePaid: result.success ? BigInt(Math.floor(result.fee * 1e6)) : undefined,
  };
}

async function executeNativeMint(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating native mint ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("zephyrUnlock");
    }
    return {
      success: true,
      txHash: `paper_mint_${Date.now().toString(16)}`,
      amountOut: step.expectedAmountOut ?? step.amountIn,
    };
  }

  let result;

  if (step.to === "ZSD.n") {
    result = await executors.zephyr.mintStable(step.amountIn);
  } else if (step.to === "ZRS.n") {
    result = await executors.zephyr.mintReserve(step.amountIn);
  } else if (step.to === "ZYS.n") {
    result = await executors.zephyr.mintYield(step.amountIn);
  } else {
    return { success: false, error: `Unknown mint target: ${step.to}` };
  }

  if (context.simulateTiming) {
    await applyDelay("zephyrUnlock");
  }

  return {
    success: result.success,
    txHash: result.txHash,
    error: result.error,
    feePaid: result.fee,
  };
}

async function executeNativeRedeem(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating native redeem ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("zephyrUnlock");
    }
    return {
      success: true,
      txHash: `paper_redeem_${Date.now().toString(16)}`,
      amountOut: step.expectedAmountOut ?? step.amountIn,
    };
  }

  let result;

  if (step.from === "ZSD.n" && step.to === "ZEPH.n") {
    result = await executors.zephyr.redeemStable(step.amountIn);
  } else if (step.from === "ZRS.n" && step.to === "ZEPH.n") {
    result = await executors.zephyr.redeemReserve(step.amountIn);
  } else if (step.from === "ZYS.n" && step.to === "ZSD.n") {
    result = await executors.zephyr.redeemYield(step.amountIn);
  } else {
    return { success: false, error: `Unknown redeem pair: ${step.from} -> ${step.to}` };
  }

  if (context.simulateTiming) {
    await applyDelay("zephyrUnlock");
  }

  return {
    success: result.success,
    txHash: result.txHash,
    error: result.error,
    feePaid: result.fee,
  };
}

async function executeWrap(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating wrap ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("zephyrUnlock");
    }
    return {
      success: true,
      txHash: `paper_wrap_${Date.now().toString(16)}`,
      amountOut: step.amountIn,
    };
  }

  const nativeAsset = step.from.replace(".n", "") as "ZEPH" | "ZSD" | "ZRS" | "ZYS";
  const evmAddress = executors.evm.address;

  const result = await executors.bridge.wrap({
    asset: nativeAsset,
    amount: step.amountIn,
    evmAddress,
  });

  return {
    success: result.success,
    txHash: result.nativeTxHash,
    error: result.error,
    feePaid: result.feePaid,
  };
}

async function executeUnwrap(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating unwrap ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("evmConfirmation");
    }
    return {
      success: true,
      txHash: `0xpaper_unwrap_${Date.now().toString(16)}`,
      amountOut: step.amountIn,
    };
  }

  const wrappedAsset = step.from as "WZEPH.e" | "WZSD.e" | "WZRS.e" | "WZYS.e";
  const nativeAddress = await executors.zephyr.getAddress();

  const result = await executors.bridge.unwrap({
    asset: wrappedAsset,
    amount: step.amountIn,
    nativeAddress,
  });

  return {
    success: result.success,
    txHash: result.evmTxHash,
    error: result.error,
    gasUsed: result.gasUsed,
  };
}

async function executeCexDeposit(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating CEX deposit ${step.from}`);
    if (context.simulateTiming) {
      const asset = step.from.replace(".n", "").replace(".e", "");
      const delayKey = asset === "ZEPH" ? "mexcDepositZeph" : "mexcDepositUsdt";
      await applyDelay(delayKey as keyof TimingDelays);
    }
    return {
      success: true,
      amountOut: step.amountIn,
    };
  }

  // CEX deposit is initiated externally (funds sent to CEX address).
  // This step just notifies the client and waits for confirmation time.
  const asset = step.from.replace(".n", "").replace(".e", "");

  if (context.simulateTiming) {
    const delayKey = asset === "ZEPH" ? "mexcDepositZeph" : "mexcDepositUsdt";
    await applyDelay(delayKey as keyof TimingDelays);
  }

  // Notify the client about the deposit
  await executors.mexc.notifyDeposit(asset, Number(step.amountIn) / 1e12);

  return {
    success: true,
    amountOut: step.amountIn,
  };
}

async function executeCexWithdraw(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating CEX withdraw ${step.from} -> ${step.to}`);
    if (context.simulateTiming) {
      await applyDelay("mexcWithdraw");
      if (step.to.endsWith(".n")) {
        await applyDelay("zephyrUnlock");
      }
    }
    return {
      success: true,
      amountOut: step.amountIn,
    };
  }

  const asset = step.from.replace(".x", "");
  const destinationAddress = await getWithdrawDestination(step.to, executors);

  const result = await executors.mexc.requestWithdraw({
    asset,
    amount: Number(step.amountIn) / 1e12,
    address: destinationAddress,
  });

  if (context.simulateTiming) {
    await applyDelay("mexcWithdraw");
    if (step.to.endsWith(".n")) {
      await applyDelay("zephyrUnlock");
    }
  }

  return {
    success: result.success,
    amountOut: result.success ? BigInt(Math.floor(result.amount * 1e12)) : undefined,
    error: result.error,
    feePaid: result.success ? BigInt(Math.floor(result.fee * 1e12)) : undefined,
  };
}

// ============================================================
// LP Operations
// ============================================================

async function executeLpMint(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  // LP mint requires pool context and position parameters
  // In paper mode, we simulate success
  // In live mode, delegates to executors.evm.executeLpMint()
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating LP mint for pool ${step.from}`);
    if (context.simulateTiming) {
      await applyDelay("evmConfirmation");
    }
    return {
      success: true,
      txHash: `0xpaper_lp_mint_${Date.now().toString(16)}`,
      amountOut: step.amountIn,
    };
  }

  // Live mode - delegate to EVM executor
  try {
    const meta = step.lpMetadata;
    if (!meta?.tickLower || !meta?.tickUpper || !step.swapContext) {
      return {
        success: false,
        error: "LP mint missing required metadata (tickLower, tickUpper, swapContext)",
      };
    }

    const result = await executors.evm.executeLpMint({
      poolKey: {
        currency0: step.swapContext.token0,
        currency1: step.swapContext.token1,
        fee: step.swapContext.fee,
        tickSpacing: step.swapContext.tickSpacing,
        hooks: step.swapContext.hooks,
      },
      tickLower: meta.tickLower,
      tickUpper: meta.tickUpper,
      liquidity: meta.liquidityAmount ?? 0n,
      amount0Max: meta.token0Amount ?? step.amountIn,
      amount1Max: meta.token1Amount ?? step.amountIn,
      slippageBps: meta.slippageBps,
    });

    return {
      success: result.success,
      txHash: result.txHash,
      error: result.error,
      gasUsed: result.gasUsed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LP mint failed",
    };
  }
}

async function executeLpBurn(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  // LP burn removes liquidity from a position
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating LP burn for pool ${step.from}`);
    if (context.simulateTiming) {
      await applyDelay("evmConfirmation");
    }
    return {
      success: true,
      txHash: `0xpaper_lp_burn_${Date.now().toString(16)}`,
      amountOut: step.amountIn,
    };
  }

  // Live mode - delegate to EVM executor
  try {
    const meta = step.lpMetadata;
    if (!meta?.positionId || !step.swapContext) {
      return {
        success: false,
        error: "LP burn missing required metadata (positionId, swapContext)",
      };
    }

    const result = await executors.evm.executeLpBurn({
      tokenId: BigInt(meta.positionId),
      poolKey: {
        currency0: step.swapContext.token0,
        currency1: step.swapContext.token1,
        fee: step.swapContext.fee,
        tickSpacing: step.swapContext.tickSpacing,
        hooks: step.swapContext.hooks,
      },
      tickLower: meta.tickLower ?? 0,
      tickUpper: meta.tickUpper ?? 0,
      liquidity: meta.liquidityAmount ?? step.amountIn,
      amount0Min: 0n,
      amount1Min: 0n,
    });

    return {
      success: result.success,
      txHash: result.txHash,
      amountOut: result.amountOut,
      error: result.error,
      gasUsed: result.gasUsed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LP burn failed",
    };
  }
}

async function executeLpCollect(
  step: ExecutionStep,
  executors: VenueExecutors,
  context: ExecutionContext,
): Promise<DispatchResult> {
  // LP collect gathers fees from a position
  if (context.mode === "paper") {
    log.info(`Paper mode: simulating LP fee collection for pool ${step.from}`);
    if (context.simulateTiming) {
      await applyDelay("evmConfirmation");
    }
    // Simulate some fees collected
    return {
      success: true,
      txHash: `0xpaper_lp_collect_${Date.now().toString(16)}`,
      amountOut: BigInt(50 * 1e6), // $50 in fees (6 decimals for USDT)
    };
  }

  // Live mode - delegate to EVM executor
  try {
    const meta = step.lpMetadata;
    if (!meta?.positionId || !step.swapContext) {
      return {
        success: false,
        error: "LP collect missing required metadata (positionId, swapContext)",
      };
    }

    const result = await executors.evm.executeLpCollect({
      tokenId: BigInt(meta.positionId),
      poolKey: {
        currency0: step.swapContext.token0,
        currency1: step.swapContext.token1,
        fee: step.swapContext.fee,
        tickSpacing: step.swapContext.tickSpacing,
        hooks: step.swapContext.hooks,
      },
      tickLower: meta.tickLower ?? 0,
      tickUpper: meta.tickUpper ?? 0,
    });

    return {
      success: result.success,
      txHash: result.txHash,
      amountOut: result.amountOut,
      error: result.error,
      gasUsed: result.gasUsed,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LP collect failed",
    };
  }
}
