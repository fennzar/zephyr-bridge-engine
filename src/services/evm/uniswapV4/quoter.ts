import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import type { AssetId } from "@domain/types";
import type { EvmPool } from "@domain/state/types";
import { env, type NetworkEnv } from "@shared";

import { getNetworkConfig, type AddressConfig } from "../config";
import { makePublicClient } from "../viemClient";
import { v4QuoterAbi } from "../abis/v4Quoter";

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface QuoteExactInputSingleParams {
  amountIn: bigint;
  pool: EvmPool;
  fromAsset: AssetId;
  toAsset: AssetId;
  env?: NetworkEnv;
  rpcUrl?: string;
  client?: PublicClient;
  hookData?: Hex;
}

export interface QuoteExactInputSingleResult {
  amountOut: bigint;
  gasEstimate?: bigint;
  poolKey: PoolKey;
  zeroForOne: boolean;
  callData: Hex;
  assets: ResolvedAssets;
  quoterAddress: Address;
}

export interface ResolvedAssets {
  fromToken: TokenResolved;
  toToken: TokenResolved;
  currency0: Address;
  currency1: Address;
  zeroForOne: boolean;
}

interface TokenResolved {
  symbol: string;
  address: string;
  decimals?: number;
  name?: string;
}

export async function quoteUniswapV4ExactInputSingle(
  params: QuoteExactInputSingleParams,
): Promise<QuoteExactInputSingleResult> {
  const { amountIn, pool, fromAsset, toAsset, env: envOverride, rpcUrl, client, hookData } = params;

  const networkEnv = envOverride ?? env.ZEPHYR_ENV;
  const config = getNetworkConfig(networkEnv);

  const assets = resolveAssets(fromAsset, toAsset, config);
  if (!assets) {
    throw new Error(`Unable to resolve token addresses for ${fromAsset} -> ${toAsset}`);
  }

  const poolKey = buildPoolKey(pool, assets);

  const quoterAddress = config.contracts?.v4Quoter;
  if (!quoterAddress) {
    throw new Error("Uniswap V4 quoter contract is not configured for this network");
  }

  const publicClient = client ?? makePublicClient(resolveRpcUrl(networkEnv, rpcUrl), networkEnv);

  const callArgs = {
    poolKey: {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
    },
    zeroForOne: assets.zeroForOne,
    exactAmount: amountIn,
    hookData: hookData ?? "0x",
  } as const;

  const callData = encodeFunctionData({
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [callArgs],
  });

  const result = await publicClient.readContract({
    address: getAddress(quoterAddress),
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [callArgs],
  });

  const [amountOut, gasEstimate] = normalizeResult(result);

  return {
    amountOut,
    gasEstimate,
    poolKey,
    zeroForOne: assets.zeroForOne,
    callData,
    assets,
    quoterAddress: getAddress(quoterAddress),
  };
}

function resolveAssets(fromAsset: AssetId, toAsset: AssetId, config: AddressConfig): ResolvedAssets | null {
  const fromToken = resolveTokenEntry(fromAsset, config);
  const toToken = resolveTokenEntry(toAsset, config);
  if (!fromToken || !toToken) return null;

  const fromAddress = getAddress(fromToken.address);
  const toAddress = getAddress(toToken.address);

  const [currency0, currency1] = sortAddresses(fromAddress, toAddress);
  const zeroForOne = fromAddress.toLowerCase() === currency0.toLowerCase();

  return {
    fromToken,
    toToken,
    currency0,
    currency1,
    zeroForOne,
  };
}

function buildPoolKey(pool: EvmPool, assets: ResolvedAssets): PoolKey {
  const feeTier = Math.max(0, Math.round(pool.feeBps ?? 0));
  if (feeTier > 1_000_000) {
    throw new Error(`Unsupported fee tier ${pool.feeBps}`);
  }

  const tickSpacing = Number.isFinite(pool.tickSpacing as number) ? (pool.tickSpacing as number) : 1;

  return {
    currency0: assets.currency0,
    currency1: assets.currency1,
    fee: feeTier,
    tickSpacing,
    hooks: zeroAddress,
  };
}

function resolveTokenEntry(asset: AssetId, config: AddressConfig): TokenResolved | null {
  const [base] = asset.split(".");
  if (!base) return null;
  const target = base.toUpperCase();

  for (const [key, entry] of Object.entries(config.tokens)) {
    const symbol = (entry.symbol ?? key).toUpperCase();
    if (symbol === target) {
      if (!entry.address) return null;
      return {
        symbol,
        address: entry.address,
        decimals: entry.decimals,
        name: entry.name,
      };
    }
  }
  return null;
}

function sortAddresses(a: Address, b: Address): [Address, Address] {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

function resolveRpcUrl(networkEnv: NetworkEnv, override?: string): string {
  if (override) return override;
  switch (networkEnv) {
    case "mainnet":
      return env.RPC_URL_MAINNET_HTTP || env.RPC_URL_HTTP;
    case "sepolia":
      return env.RPC_URL_SEPOLIA_HTTP || env.RPC_URL_HTTP;
    case "local":
    default:
      return env.RPC_URL_LOCAL_HTTP || env.RPC_URL_HTTP;
  }
}

function normalizeResult(value: unknown): readonly [bigint, bigint | undefined] {
  if (Array.isArray(value)) {
    const [amount, gas] = value as unknown[];
    return [toBigInt(amount), gas != null ? toBigInt(gas) : undefined];
  }
  return [toBigInt(value), undefined];
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  if (value == null) return 0n;
  throw new Error("Unable to convert value to bigint");
}
