import { getAddress } from "viem";

import type { AssetId } from "@domain/types";
import type { EvmPool } from "@domain/state/types";
import type { NetworkEnv } from "@shared";

import { getNetworkConfig } from "./config";

/**
 * Resolve a token contract address from an AssetId (e.g. "WZEPH.e" → address).
 * Returns null if the asset is not found in the network config.
 */
export function getTokenAddress(asset: AssetId, network: NetworkEnv): string | null {
  const symbol = asset.replace(".e", "").toUpperCase();
  return getTokenAddressFromSymbol(symbol, network);
}

/**
 * Resolve a token contract address from a symbol string (e.g. "WZEPH" → address).
 * Normalises by stripping ".e" suffix and uppercasing.
 * Returns null if not found or address is the zero address.
 */
export function getTokenAddressFromSymbol(symbol: string | AssetId, network: NetworkEnv): string | null {
  const config = getNetworkConfig(network);
  const normalized = String(symbol).replace(".e", "").toUpperCase();

  const tokenMap: Record<string, string> = {
    WZEPH: config.tokens?.WZEPH?.address ?? config.tokens?.wZEPH?.address ?? "",
    WZSD: config.tokens?.WZSD?.address ?? config.tokens?.wZSD?.address ?? "",
    WZRS: config.tokens?.WZRS?.address ?? config.tokens?.wZRS?.address ?? "",
    WZYS: config.tokens?.WZYS?.address ?? config.tokens?.wZYS?.address ?? "",
    USDT: config.tokens?.USDT?.address ?? "",
    USDC: config.tokens?.USDC?.address ?? "",
  };

  const address = tokenMap[normalized];
  return address && address !== "0x0000000000000000000000000000000000000000" ? address : null;
}

/**
 * Build a Uniswap V4 PoolKey struct from an EvmPool definition.
 * Sorts tokens into currency0/currency1 order (lower address first).
 */
export function buildPoolKeyFromPool(pool: EvmPool, network: NetworkEnv) {
  const baseToken = getTokenAddressFromSymbol(pool.base, network);
  const quoteToken = getTokenAddressFromSymbol(pool.quote, network);

  if (!baseToken || !quoteToken) {
    throw new Error(`Cannot resolve tokens for pool ${pool.key}`);
  }

  // Sort tokens to get currency0/currency1
  const [currency0, currency1] =
    baseToken.toLowerCase() < quoteToken.toLowerCase()
      ? [baseToken, quoteToken]
      : [quoteToken, baseToken];

  return {
    currency0: getAddress(currency0),
    currency1: getAddress(currency1),
    fee: pool.feeBps, // Already in Uniswap V4 fee units (e.g. 3000 = 0.30%)
    tickSpacing: pool.tickSpacing ?? 60,
    hooks: getAddress("0x0000000000000000000000000000000000000000"),
  };
}

/**
 * Determine the swap direction (zeroForOne) based on token address ordering.
 */
export function isZeroForOne(from: AssetId, to: AssetId, _pool: EvmPool, network: NetworkEnv): boolean {
  const fromToken = getTokenAddress(from, network);
  const toToken = getTokenAddress(to, network);
  if (!fromToken || !toToken) return true;
  return fromToken.toLowerCase() < toToken.toLowerCase();
}
