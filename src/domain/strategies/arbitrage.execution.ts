import type { GlobalState } from "@domain/state";
import type { ArbLegs, SemanticStep } from "@domain/arbitrage/routing";
import type { ExecutionStep, SwapContext } from "@domain/execution/types";
import type { AssetId, Venue, OpType } from "@domain/types";

/**
 * Estimate the output amount of a swap given price, fee, and slippage.
 * @param amountIn  Input amount in atomic units
 * @param price     Output/input price ratio (e.g. 0.5 means 1 input = 0.5 output)
 * @param feeBps    Pool fee in Uniswap V4 fee units (e.g. 3000 = 0.3%)
 * @param slippageBps  Estimated slippage in basis points (e.g. 50 = 0.5%)
 */
export function estimateSwapOutput(
  amountIn: bigint,
  price: number,
  feeBps: number,
  slippageBps: number,
): bigint {
  if (amountIn <= 0n || price <= 0) return 0n;
  const SCALE = 1_000_000n;
  const grossOut = (amountIn * BigInt(Math.floor(price * 1e6))) / SCALE;
  // feeBps is in V4 units: 3000 means 0.3%, so divide by 1_000_000
  const feeDeduction = (grossOut * BigInt(feeBps)) / 1_000_000n;
  const slipDeduction = (grossOut * BigInt(slippageBps)) / 10_000n;
  const result = grossOut - feeDeduction - slipDeduction;
  return result > 0n ? result : 0n;
}

/**
 * Build ExecutionStep[] from ArbLegs semantic steps.
 * The clipAmount is used for the first step; subsequent steps chain estimated outputs.
 */
export function buildExecutionSteps(
  leg: ArbLegs,
  closeSteps: SemanticStep[],
  planId: string,
  clipAmount: bigint = 0n,
  state?: GlobalState,
): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  let stepIndex = 0;
  let currentAmount = clipAmount;

  // Open steps (EVM swap)
  for (const semanticStep of leg.open) {
    for (const op of semanticStep.op) {
      const swapCtx = op === "swapEVM"
        ? lookupSwapContext(semanticStep.from, semanticStep.to, state)
        : undefined;
      const price = getStepPrice(semanticStep.from, semanticStep.to, op, state);
      const fee = swapCtx ? swapCtx.fee : 0;
      const expectedOut = estimateSwapOutput(currentAmount, price, fee, 50);

      steps.push({
        planStepId: `${planId}-open-${stepIndex++}`,
        op,
        from: semanticStep.from,
        to: semanticStep.to,
        amountIn: currentAmount,
        expectedAmountOut: expectedOut,
        venue: getVenueForOp(op),
        swapContext: swapCtx,
      });
      currentAmount = expectedOut;
    }
  }

  // Bridge step: unwrap EVM asset to native if close steps need native input.
  // Applies to both directions when the open step produces an EVM asset (.e)
  // and the close step expects a native asset (.n).
  const openResult = leg.open[leg.open.length - 1]?.to;
  const closeInput = closeSteps[0]?.from;
  if (openResult?.endsWith(".e") && closeInput?.endsWith(".n")) {
    const nativeAsset = openResult.replace("W", "").replace(".e", ".n") as typeof openResult;
    // Bridge is ~1:1 minus bridge fee (~1%)
    const bridgeFee = state?.bridge?.unwrap.bridgeFee ?? 0.01;
    const bridgeOut = currentAmount - BigInt(Math.floor(Number(currentAmount) * bridgeFee));
    steps.push({
      planStepId: `${planId}-unwrap-${stepIndex++}`,
      op: "unwrap",
      from: openResult,
      to: nativeAsset,
      amountIn: currentAmount,
      expectedAmountOut: bridgeOut,
      venue: "evm",
    });
    currentAmount = bridgeOut;
  }

  // Close steps (native conversion or CEX trade)
  for (const semanticStep of closeSteps) {
    for (const op of semanticStep.op) {
      const price = getStepPrice(semanticStep.from, semanticStep.to, op, state);
      const fee = op === "tradeCEX" ? (state?.cex?.fees.takerBps ?? 20) * 100 : 0;
      const expectedOut = estimateSwapOutput(currentAmount, price, fee, 50);

      steps.push({
        planStepId: `${planId}-close-${stepIndex++}`,
        op,
        from: semanticStep.from,
        to: semanticStep.to,
        amountIn: currentAmount,
        expectedAmountOut: expectedOut,
        venue: getVenueForOp(op),
      });
      currentAmount = expectedOut;
    }
  }

  // If close ended on native and we need to return to EVM, add wrap
  const lastClose = closeSteps[closeSteps.length - 1];
  if (lastClose && lastClose.to.endsWith(".n")) {
    const evmAsset = `W${lastClose.to.replace(".n", ".e")}` as typeof lastClose.to;
    const wrapFee = state?.bridge?.wrap.gasFee ?? 0;
    const wrapOut = currentAmount - BigInt(Math.floor(Number(currentAmount) * wrapFee));
    steps.push({
      planStepId: `${planId}-wrap-${stepIndex++}`,
      op: "wrap",
      from: lastClose.to,
      to: evmAsset,
      amountIn: currentAmount,
      expectedAmountOut: wrapOut,
      venue: "native",
    });
  }

  return steps;
}

/**
 * Get the price ratio (output/input) for a step based on venue and state.
 */
export function getStepPrice(
  from: AssetId,
  to: AssetId,
  op: OpType,
  state?: GlobalState,
): number {
  if (!state) return 1;

  // EVM swap: look up pool price
  if (op === "swapEVM") {
    const pools = state.evm?.pools ?? {};
    for (const pool of Object.values(pools)) {
      if (pool.base === from && pool.quote === to && pool.price != null) {
        return pool.price;
      }
      if (pool.base === to && pool.quote === from && pool.priceInverse != null) {
        return pool.priceInverse;
      }
    }
  }

  // Native mint/redeem: use reserve rates
  const reserve = state.zephyr?.reserve;
  if (reserve && (op === "nativeMint" || op === "nativeRedeem")) {
    // ZEPH -> ZSD (mint stable): rate = zsd spot (ZEPH per ZSD)
    if (from === "ZEPH.n" && to === "ZSD.n") return reserve.rates.zsd.spot;
    if (from === "ZSD.n" && to === "ZEPH.n") return 1 / reserve.rates.zsd.spot;
    if (from === "ZEPH.n" && to === "ZRS.n") return reserve.rates.zrs.spot;
    if (from === "ZRS.n" && to === "ZEPH.n") return 1 / reserve.rates.zrs.spot;
    if (from === "ZSD.n" && to === "ZYS.n") return reserve.rates.zys.spot;
    if (from === "ZYS.n" && to === "ZSD.n") return 1 / reserve.rates.zys.spot;
  }

  // CEX trade: use mid price
  if (op === "tradeCEX") {
    const markets = state.cex?.markets ?? {};
    for (const market of Object.values(markets)) {
      if (market.bid != null && market.ask != null) {
        const mid = (market.bid + market.ask) / 2;
        if (market.base === from && market.quote === to) return mid;
        if (market.base === to && market.quote === from && mid > 0) return 1 / mid;
      }
    }
  }

  // wrap/unwrap: 1:1
  return 1;
}

/**
 * Look up swap context from GlobalState EVM pools.
 */
export function lookupSwapContext(
  from: AssetId,
  to: AssetId,
  state?: GlobalState,
): SwapContext | undefined {
  if (!state?.evm?.pools) return undefined;
  const pools = state.evm.pools;
  for (const pool of Object.values(pools)) {
    if (
      (pool.base === from && pool.quote === to) ||
      (pool.base === to && pool.quote === from)
    ) {
      if (!pool.address) continue;
      return {
        poolAddress: pool.address,
        token0: pool.base,
        token1: pool.quote,
        fee: pool.feeBps, // Already in V4 fee units (e.g. 3000 = 0.30%)
        tickSpacing: pool.tickSpacing ?? 60,
        hooks: "0x0000000000000000000000000000000000000000",
      };
    }
  }
  return undefined;
}

/**
 * Get venue for an operation type.
 */
export function getVenueForOp(op: OpType): Venue {
  switch (op) {
    case "swapEVM":
    case "unwrap":
      return "evm";
    case "wrap":
    case "nativeMint":
    case "nativeRedeem":
      return "native";
    case "tradeCEX":
    case "deposit":
    case "withdraw":
      return "cex";
    default:
      return "evm";
  }
}

/**
 * Estimate total duration for execution.
 */
export function estimateDuration(steps: ExecutionStep[]): number {
  let duration = 0;

  for (const step of steps) {
    switch (step.op) {
      case "wrap":
      case "unwrap":
        duration += 20 * 60 * 1000; // 20 min bridge time
        break;
      case "deposit":
        duration += 40 * 60 * 1000; // 40 min CEX deposit
        break;
      case "withdraw":
        duration += 10 * 60 * 1000; // 10 min CEX withdrawal
        break;
      case "swapEVM":
        duration += 30 * 1000; // 30 sec
        break;
      case "tradeCEX":
        duration += 5 * 1000; // 5 sec
        break;
      case "nativeMint":
      case "nativeRedeem":
        duration += 2 * 60 * 1000; // 2 min for block confirmation
        break;
      default:
        duration += 60 * 1000;
    }
  }

  return duration;
}
