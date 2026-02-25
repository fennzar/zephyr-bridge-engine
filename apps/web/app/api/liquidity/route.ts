import { NextResponse } from "next/server";
import { formatUnits } from "viem";

import { env, type NetworkEnv } from "@shared";
import { getTrackedTokens } from "@services/evm/config";
import { makePublicClient, getPools, getPositions } from "@services/evm";
import type { PoolOverview, PositionOverview } from "@services";

export const dynamic = "force-dynamic";

const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

type TokenBalance = {
  symbol: string;
  address: string;
  decimals: number;
  balance: string;
  balanceNumber: number;
  group: "wrapped" | "stablecoin" | "other";
};

type PoolLiquidity = {
  name: string;
  poolId: string;
  base: string;
  quote: string;
  tvlUsd: number;
  liquidity: string | null;
  positionCount: number;
};

type SeedingStatus = "seeded" | "partial" | "not_seeded";

export type LiquidityResponse = {
  address: string | null;
  seedingStatus: SeedingStatus;
  ethBalance: string;
  tokenBalances: TokenBalance[];
  pools: PoolLiquidity[];
  positions: PositionOverview[];
  totalTvlUsd: number;
  timestamp: string;
  error?: string;
};

function parseNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

const WRAPPED_TOKENS = new Set(["wZEPH", "wZSD", "wZRS", "wZYS"]);
const STABLECOINS = new Set(["USDC", "USDT"]);

function tokenGroup(symbol: string): TokenBalance["group"] {
  if (WRAPPED_TOKENS.has(symbol)) return "wrapped";
  if (STABLECOINS.has(symbol)) return "stablecoin";
  return "other";
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const network = env.ZEPHYR_ENV as NetworkEnv;
  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL || null;
  const walletAddress =
    env.EVM_WALLET_ADDRESS ?? process.env.EVM_WALLET_ADDRESS ?? null;

  if (!walletAddress || !rpcUrl) {
    return NextResponse.json({
      address: walletAddress,
      seedingStatus: "not_seeded" as SeedingStatus,
      ethBalance: "0",
      tokenBalances: [],
      pools: [],
      positions: [],
      totalTvlUsd: 0,
      timestamp,
      error: !walletAddress
        ? "EVM_WALLET_ADDRESS not configured"
        : "RPC_URL_HTTP not configured",
    } satisfies LiquidityResponse);
  }

  try {
    const client = makePublicClient(rpcUrl, network);
    const hexAddress = walletAddress as `0x${string}`;
    const trackedTokens = getTrackedTokens(network);

    // Parallel: ETH balance, token balances, pools, positions
    const [nativeRaw, tokenResults, pools, positions] = await Promise.all([
      client.getBalance({ address: hexAddress }),
      Promise.all(
        trackedTokens.map(async (token) => {
          try {
            const raw = (await client.readContract({
              address: token.address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [hexAddress],
            })) as bigint;
            const formatted = formatUnits(raw, token.decimals);
            return {
              symbol: token.symbol,
              address: token.address,
              decimals: token.decimals,
              balance: formatted,
              balanceNumber: parseNumber(formatted),
              group: tokenGroup(token.symbol),
            } satisfies TokenBalance;
          } catch {
            return {
              symbol: token.symbol,
              address: token.address,
              decimals: token.decimals,
              balance: "0",
              balanceNumber: 0,
              group: tokenGroup(token.symbol),
            } satisfies TokenBalance;
          }
        }),
      ),
      getPools().catch(() => [] as PoolOverview[]),
      getPositions(null, hexAddress).catch(() => [] as PositionOverview[]),
    ]);

    const ethBalance = formatUnits(nativeRaw, 18);

    // Map pools to liquidity summary
    const poolLiquidity: PoolLiquidity[] = pools.map((pool) => ({
      name: `${pool.base.symbol}/${pool.quote.symbol}`,
      poolId: pool.id,
      base: pool.base.symbol,
      quote: pool.quote.symbol,
      tvlUsd: pool.tvlUsd,
      liquidity: pool.totalToken0 != null ? pool.totalToken0.toString() : null,
      positionCount: pool.activePositions,
    }));

    const totalTvlUsd = pools.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0);

    // Determine seeding status
    const hasWrapped = tokenResults.some(
      (t) => t.group === "wrapped" && t.balanceNumber > 0,
    );
    const poolsHaveLiquidity =
      pools.length > 0 && pools.some((p) => p.tvlUsd > 0);

    let seedingStatus: SeedingStatus = "not_seeded";
    if (poolsHaveLiquidity && hasWrapped) {
      seedingStatus = "seeded";
    } else if (hasWrapped || poolsHaveLiquidity) {
      seedingStatus = "partial";
    }

    return NextResponse.json({
      address: walletAddress,
      seedingStatus,
      ethBalance,
      tokenBalances: tokenResults,
      pools: poolLiquidity,
      positions,
      totalTvlUsd,
      timestamp,
    } satisfies LiquidityResponse);
  } catch (error) {
    return NextResponse.json(
      {
        address: walletAddress,
        seedingStatus: "not_seeded" as SeedingStatus,
        ethBalance: "0",
        tokenBalances: [],
        pools: [],
        positions: [],
        totalTvlUsd: 0,
        timestamp,
        error:
          error instanceof Error ? error.message : "Failed to load liquidity data",
      } satisfies LiquidityResponse,
      { status: 500 },
    );
  }
}
