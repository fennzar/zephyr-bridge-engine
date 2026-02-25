import type { AssetId } from "@domain/types";
import { decimalToBigInt } from "@domain/core/conversion";
import type { EvmPool, GlobalState } from "@domain/state/types";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { OperationQuoteRequest } from "./types";
import { quoteUniswapV4ExactInputSingle } from "@services/evm/uniswapV4/quoter";
import { makePublicClient } from "@services/evm/viemClient";
import { getNetworkConfig } from "@services/evm/config";
import { env, type NetworkEnv } from "@shared";
import type { Address, Hex, PublicClient } from "viem";
import { formatUnits, getAddress } from "viem";
import type { SwapPoolImpact } from "./types";

export interface OnchainSwapQuote {
  request: OperationQuoteRequest;
  amountOut: bigint;
  estGasWei?: bigint;
  zeroForOne: boolean;
  warnings?: string[];
  amount0Delta?: bigint;
  amount1Delta?: bigint;
  poolBaseBeforeRaw?: bigint;
  poolQuoteBeforeRaw?: bigint;
  poolBaseAfterRaw?: bigint;
  poolQuoteAfterRaw?: bigint;
  sqrtPriceX96After?: bigint;
  poolPriceBefore?: number | null;
  poolPriceBeforeRaw?: number | null;
  poolPriceAfter?: number | null;
  poolPriceAfterRaw?: number | null;
  poolPriceAfterSqrt?: number | null;
  priceImpactBps?: number | null;
  poolImpact?: SwapPoolImpact;
}

export async function quoteSwapOnchain(request: OperationQuoteRequest, state: GlobalState): Promise<OnchainSwapQuote | null> {
  if (request.op !== "swapEVM") return null;

  if (request.amountIn == null) return null;

  const runtime = OP_RUNTIME.swapEVM as OperationRuntime<SwapEvmContext> | undefined;
  if (!runtime) return null;

  const enabled = runtime.enabled(request.from, request.to, state);
  if (!enabled) return null;

  const context = runtime.buildContext(request.from, request.to, state);
  if (!context) return null;

  const warnings: string[] = [];
  if (context.watcherStale) warnings.push("watcher data stale");

  const networkEnv = env.ZEPHYR_ENV as NetworkEnv;
  const rpcUrl = resolveRpcUrl(networkEnv);
  const config = getNetworkConfig(networkEnv);
  const traceClient = rpcUrl ? makePublicClient(rpcUrl, networkEnv) : null;

  const result = await quoteUniswapV4ExactInputSingle({
    amountIn: request.amountIn,
    fromAsset: request.from,
    toAsset: request.to,
    pool: context.pool,
    client: traceClient ?? undefined,
  });

  const baseDecimals = context.pool.baseDecimals ?? 0;
  const quoteDecimals = context.pool.quoteDecimals ?? 0;

  const poolBaseBeforeRaw =
    context.pool.totalBase != null ? decimalToBigInt(context.pool.totalBase, baseDecimals) : undefined;
  const poolQuoteBeforeRaw =
    context.pool.totalQuote != null ? decimalToBigInt(context.pool.totalQuote, quoteDecimals) : undefined;

  const rawPriceBefore = computePoolPrice(poolQuoteBeforeRaw, poolBaseBeforeRaw, quoteDecimals, baseDecimals);
  const priceBefore = resolvePoolPrice(context.pool.price, poolQuoteBeforeRaw, poolBaseBeforeRaw, quoteDecimals, baseDecimals);

  let amount0Delta: bigint | undefined;
  let amount1Delta: bigint | undefined;
  let poolBaseAfterRaw: bigint | undefined;
  let poolQuoteAfterRaw: bigint | undefined;
  let sqrtPriceX96After: bigint | undefined;
  let poolPriceAfter: number | null = null;
  let rawPriceAfter: number | null = null;
  let poolBaseDeltaRaw: bigint | undefined;
  let poolQuoteDeltaRaw: bigint | undefined;
  const priceToken0Asset: AssetId | null = result.assets.zeroForOne ? request.from : request.to;
  const priceToken1Asset: AssetId | null = result.assets.zeroForOne ? request.to : request.from;

  if (traceClient && config.contracts?.poolManager) {
    const poolManagerAddress = getAddress(config.contracts.poolManager);
    try {
      const trace = await traceSwapBalanceDelta(traceClient, result.quoterAddress, result.callData, poolManagerAddress);
      if (trace) {
        amount0Delta = trace.amount0;
        amount1Delta = trace.amount1;

        const baseDelta = (() => {
          if (context.pool.base === priceToken0Asset) return amount0Delta;
          if (context.pool.base === priceToken1Asset) return amount1Delta;
          return undefined;
        })();

        const quoteDelta = (() => {
          if (context.pool.quote === priceToken0Asset) return amount0Delta;
          if (context.pool.quote === priceToken1Asset) return amount1Delta;
          return undefined;
        })();

        poolBaseDeltaRaw = baseDelta != null ? -baseDelta : undefined;
        poolQuoteDeltaRaw = quoteDelta != null ? -quoteDelta : undefined;

        if (poolBaseBeforeRaw != null && poolBaseDeltaRaw != null) {
          const candidate = poolBaseBeforeRaw + poolBaseDeltaRaw;
          if (candidate > 0n) {
            poolBaseAfterRaw = candidate;
          }
        }

        if (poolQuoteBeforeRaw != null && poolQuoteDeltaRaw != null) {
          const candidate = poolQuoteBeforeRaw + poolQuoteDeltaRaw;
          if (candidate > 0n) {
            poolQuoteAfterRaw = candidate;
          }
        }

        if (poolBaseAfterRaw != null && poolQuoteAfterRaw != null) {
          sqrtPriceX96After = encodeSqrtRatioX96(poolQuoteAfterRaw, poolBaseAfterRaw);
          rawPriceAfter = computePoolPrice(poolQuoteAfterRaw, poolBaseAfterRaw, quoteDecimals, baseDecimals);
        }
      } else {
        warnings.push("on-chain trace unavailable");
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "debug trace failed");
    }
  } else {
    if (!rpcUrl) warnings.push("rpc url unavailable for tracing");
    if (!config.contracts?.poolManager) warnings.push("poolManager address missing");
  }

  if (rawPriceAfter == null && poolBaseAfterRaw != null && poolQuoteAfterRaw != null) {
    rawPriceAfter = computePoolPrice(poolQuoteAfterRaw, poolBaseAfterRaw, quoteDecimals, baseDecimals);
  }

  if (poolPriceAfter == null) {
    if (priceBefore != null && rawPriceBefore != null && rawPriceBefore !== 0 && rawPriceAfter != null) {
      poolPriceAfter = priceBefore * (rawPriceAfter / rawPriceBefore);
    } else {
      poolPriceAfter = rawPriceAfter;
    }
  }

  const priceAfterFromSqrt = computePriceFromSqrtRatio(sqrtPriceX96After, baseDecimals, quoteDecimals);

  return {
    request,
    amountOut: result.amountOut,
    estGasWei: result.gasEstimate,
    zeroForOne: result.zeroForOne,
    warnings: warnings.length > 0 ? warnings : undefined,
    amount0Delta,
    amount1Delta,
    poolBaseBeforeRaw,
    poolQuoteBeforeRaw,
    poolBaseAfterRaw,
    poolQuoteAfterRaw,
    sqrtPriceX96After,
    poolPriceBefore: priceBefore,
    poolPriceBeforeRaw: rawPriceBefore,
    poolPriceAfter,
    poolPriceAfterRaw: rawPriceAfter,
    poolPriceAfterSqrt: priceAfterFromSqrt,
    priceImpactBps: computePriceImpactBps(priceBefore, poolPriceAfter),
    poolImpact: buildPoolImpact(
      context.pool,
      poolBaseBeforeRaw,
      poolQuoteBeforeRaw,
      poolBaseAfterRaw,
      poolQuoteAfterRaw,
      priceBefore,
      poolPriceAfter,
      rawPriceBefore,
      rawPriceAfter,
      priceAfterFromSqrt,
      quoteDecimals,
      baseDecimals,
      poolBaseDeltaRaw,
      poolQuoteDeltaRaw,
    ),
  };
}

interface CallTraceNode {
  to?: string;
  input?: string;
  output?: string;
  calls?: CallTraceNode[];
}

interface TraceDelta {
  amount0: bigint;
  amount1: bigint;
}

async function traceSwapBalanceDelta(
  client: PublicClient,
  quoterAddress: Address,
  callData: Hex,
  poolManagerAddress: Address,
): Promise<TraceDelta | null> {
  const trace = await client.transport.request({
    method: "debug_traceCall",
    params: [
      {
        to: quoterAddress,
        data: callData,
      },
      "latest",
      { tracer: "callTracer" },
    ],
  });

  if (!trace || typeof trace !== "object") return null;
  const swapCall = findSwapCall(trace as CallTraceNode, poolManagerAddress.toLowerCase());
  if (!swapCall?.output) return null;
  return parseBalanceDelta(swapCall.output);
}

function findSwapCall(node: CallTraceNode | undefined, poolManager: string): CallTraceNode | null {
  if (!node) return null;
  const target = node.to?.toLowerCase();
  if (target === poolManager && node.input?.startsWith("0xf3cd914c")) {
    return node;
  }
  if (node.calls) {
    for (const child of node.calls) {
      const found = findSwapCall(child, poolManager);
      if (found) return found;
    }
  }
  return null;
}

function parseBalanceDelta(output: string): TraceDelta | null {
  if (!output || output === "0x") return null;
  const value = BigInt(output);
  const mask = (1n << 128n) - 1n;
  const amount0 = BigInt.asIntN(128, value >> 128n);
  const amount1 = BigInt.asIntN(128, value & mask);
  return { amount0, amount1 };
}

function encodeSqrtRatioX96(amount1: bigint, amount0: bigint): bigint {
  if (amount0 <= 0n || amount1 <= 0n) return 0n;
  const ratioX192 = (amount1 << 192n) / amount0;
  return sqrtBigInt(ratioX192);
}

function sqrtBigInt(value: bigint): bigint {
  if (value <= 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) {
    z = x;
    x = (value / x + x) >> 1n;
  }
  return z;
}

function resolveRpcUrl(networkEnv: NetworkEnv): string | null {
  switch (networkEnv) {
    case "mainnet":
      return env.RPC_URL_MAINNET_HTTP || env.RPC_URL_HTTP || env.RPC_URL || null;
    case "sepolia":
      return env.RPC_URL_SEPOLIA_HTTP || env.RPC_URL_HTTP || env.RPC_URL || null;
    case "local":
    default:
      return env.RPC_URL_LOCAL_HTTP || env.RPC_URL_HTTP || env.RPC_URL || null;
  }
}

function computePoolPrice(
  quoteRaw: bigint | undefined,
  baseRaw: bigint | undefined,
  quoteDecimals: number,
  baseDecimals: number,
): number | null {
  if (quoteRaw == null || baseRaw == null || baseRaw === 0n) return null;
  const quote = Number(quoteRaw) / 10 ** quoteDecimals;
  const base = Number(baseRaw) / 10 ** baseDecimals;
  if (!Number.isFinite(quote) || !Number.isFinite(base) || base === 0) return null;
  return quote / base;
}

function resolvePoolPrice(
  explicit: number | null | undefined,
  quoteRaw: bigint | undefined,
  baseRaw: bigint | undefined,
  quoteDecimals: number,
  baseDecimals: number,
): number | null {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit;
  return computePoolPrice(quoteRaw, baseRaw, quoteDecimals, baseDecimals);
}

function computePriceImpactBps(priceBefore: number | null, priceAfter: number | null): number | null {
  if (priceBefore == null || priceAfter == null || priceBefore === 0) return null;
  return ((priceAfter / priceBefore) - 1) * 10_000;
}

function formatPriceString(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const fixed = value.toFixed(12);
  return fixed.replace(/\.0+$/, "").replace(/(\.[0-9]*[1-9])0+$/, "$1");
}

function computePriceFromSqrtRatio(
  sqrtPriceX96: bigint | null | undefined,
  baseDecimals: number,
  quoteDecimals: number,
): number | null {
  if (sqrtPriceX96 == null) return null;
  const sqrtRatio = Number(sqrtPriceX96) / 2 ** 96;
  if (!Number.isFinite(sqrtRatio)) return null;
  const priceToken1PerToken0 = sqrtRatio * sqrtRatio;
  const decimalFactor = Math.pow(10, baseDecimals - quoteDecimals);
  const price = priceToken1PerToken0 * decimalFactor;
  return Number.isFinite(price) ? price : null;
}

function buildPoolImpact(
  pool: EvmPool,
  baseBeforeRaw: bigint | undefined,
  quoteBeforeRaw: bigint | undefined,
  baseAfterRaw: bigint | undefined,
  quoteAfterRaw: bigint | undefined,
  priceBefore: number | null,
  priceAfter: number | null,
  rawPriceBefore: number | null,
  rawPriceAfter: number | null,
  priceAfterSqrt: number | null,
  quoteDecimals: number,
  baseDecimals: number,
  baseDeltaRaw: bigint | undefined,
  quoteDeltaRaw: bigint | undefined,
): SwapPoolImpact | undefined {
  const hasBefore = baseBeforeRaw != null || quoteBeforeRaw != null || priceBefore != null;
  const hasAfter = baseAfterRaw != null || quoteAfterRaw != null || priceAfter != null;
  if (!hasBefore && !hasAfter) return undefined;

  const formatReserve = (raw: bigint | undefined, decimals: number): string | null => {
    if (raw == null) return null;
    return formatUnits(raw, decimals);
  };

  const formatDelta = (raw: bigint | undefined, decimals: number): string | null => {
    if (raw == null) return null;
    return formatUnits(raw, decimals);
  };

  const resolvedPriceBefore = priceBefore ?? rawPriceBefore;
  const resolvedPriceAfter = priceAfter ?? rawPriceAfter;
  const priceImpactBps = computePriceImpactBps(resolvedPriceBefore, resolvedPriceAfter);

  return {
    poolKey: pool.key,
    baseAsset: pool.base,
    quoteAsset: pool.quote,
    priceBefore: formatPriceString(resolvedPriceBefore),
    priceAfter: formatPriceString(resolvedPriceAfter),
    priceBeforeRaw: formatPriceString(rawPriceBefore),
    priceAfterRaw: formatPriceString(rawPriceAfter),
    priceAfterSqrt: formatPriceString(priceAfterSqrt),
    priceImpactBps,
    baseReserveBefore: formatReserve(baseBeforeRaw, baseDecimals),
    baseReserveAfter: formatReserve(baseAfterRaw, baseDecimals),
    quoteReserveBefore: formatReserve(quoteBeforeRaw, quoteDecimals),
    quoteReserveAfter: formatReserve(quoteAfterRaw, quoteDecimals),
    baseDelta: formatDelta(baseDeltaRaw, baseDecimals),
    quoteDelta: formatDelta(quoteDeltaRaw, quoteDecimals),
  };
}
