import { NextResponse } from "next/server";
import { formatUnits } from "viem";

import { env, type NetworkEnv } from "@shared";
import { getTrackedTokens } from "@services/evm/config";
import { makePublicClient } from "@services/evm";

import { readPaperBalances } from "@services/paperBalanceStore";
import { createZephyrWalletClient } from "@services/zephyr/wallet";

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
  key: string;
  symbol: string;
  address: string;
  decimals: number;
  balance: string;
  balanceNumber: number | null;
  raw: string;
  error?: string | null;
};

type NativeBalance = {
  symbol: string;
  balance: string;
  balanceNumber: number | null;
  raw: string;
};

type EvmBalanceResponse = {
  address: string | null;
  network: NetworkEnv;
  rpcUrl: string | null;
  status: "ok" | "missing-address" | "missing-rpc" | "error";
  native: NativeBalance | null;
  tokens: TokenBalance[];
  error: string | null;
};

type BalanceConfig = {
  mexcPaper: boolean;
  zephyrPaper: boolean;
};

function parseNumber(value: string): number | null {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function GET() {
  const timestamp = new Date().toISOString();

  const network = env.ZEPHYR_ENV as NetworkEnv;
  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL || null;
  const walletAddress =
    env.EVM_WALLET_ADDRESS ?? process.env.EVM_WALLET_ADDRESS ?? null;

  const evm: EvmBalanceResponse = {
    address: walletAddress,
    network,
    rpcUrl,
    status: "ok",
    native: null,
    tokens: [],
    error: null,
  };

  if (!walletAddress) {
    evm.status = "missing-address";
    evm.error = "EVM_WALLET_ADDRESS not configured";
  } else if (!rpcUrl) {
    evm.status = "missing-rpc";
    evm.error = "RPC_URL_HTTP not configured";
  } else {
    try {
      const client = makePublicClient(rpcUrl, network);
      const hexAddress = walletAddress as `0x${string}`;
      const [nativeRaw, tokens] = await Promise.all([
        client.getBalance({ address: hexAddress }),
        Promise.all(
          getTrackedTokens(network).map(async (token) => {
            try {
              const raw = (await client.readContract({
                address: token.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [hexAddress],
              })) as bigint;
              const formatted = formatUnits(raw, token.decimals);
              return {
                key: token.key,
                symbol: token.symbol,
                address: token.address,
                decimals: token.decimals,
                balance: formatted,
                balanceNumber: parseNumber(formatted),
                raw: raw.toString(),
                error: null,
              } satisfies TokenBalance;
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Unknown balance error";
              return {
                key: token.key,
                symbol: token.symbol,
                address: token.address,
                decimals: token.decimals,
                balance: "0",
                balanceNumber: 0,
                raw: "0",
                error: message,
              } satisfies TokenBalance;
            }
          }),
        ),
      ]);

      const nativeFormatted = formatUnits(nativeRaw, 18);
      evm.native = {
        symbol: "ETH",
        balance: nativeFormatted,
        balanceNumber: parseNumber(nativeFormatted),
        raw: nativeRaw.toString(),
      };
      evm.tokens = tokens;
      evm.status = "ok";
    } catch (error) {
      evm.status = "error";
      evm.error = error instanceof Error ? error.message : "Failed to load EVM balances";
    }
  }

  // Load real Zephyr wallet balances when not in paper mode
  let zephyrWallet: {
    status: "ok" | "error";
    address: string | null;
    balances: {
      zeph: number; zsd: number; zrs: number; zys: number;
      unlockedZeph: number; unlockedZsd: number; unlockedZrs: number; unlockedZys: number;
    } | null;
    error?: string;
  } | null = null;

  if (!env.ZEPHYR_PAPER) {
    try {
      const wallet = createZephyrWalletClient();
      const [address, bal] = await Promise.all([wallet.getAddress(), wallet.getBalance()]);
      const ATOMIC = 1e12;
      zephyrWallet = {
        status: "ok",
        address,
        balances: {
          zeph: Number(bal.zeph) / ATOMIC,
          zsd: Number(bal.zsd) / ATOMIC,
          zrs: Number(bal.zrs) / ATOMIC,
          zys: Number(bal.zys) / ATOMIC,
          unlockedZeph: Number(bal.unlockedZeph) / ATOMIC,
          unlockedZsd: Number(bal.unlockedZsd) / ATOMIC,
          unlockedZrs: Number(bal.unlockedZrs) / ATOMIC,
          unlockedZys: Number(bal.unlockedZys) / ATOMIC,
        },
      };
    } catch (error) {
      zephyrWallet = {
        status: "error",
        address: null,
        balances: null,
        error: error instanceof Error ? error.message : "Failed to load Zephyr wallet",
      };
    }
  }

  try {
    const paper = await readPaperBalances();
    return NextResponse.json({
      timestamp,
      evm,
      paper,
      zephyrWallet,
      config: {
        mexcPaper: Boolean(env.MEXC_PAPER),
        zephyrPaper: Boolean(env.ZEPHYR_PAPER),
      } satisfies BalanceConfig,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load paper balances";
    return NextResponse.json(
      {
        timestamp,
        evm,
        paper: {
          mexc: {},
          zephyr: {},
          updatedAt: timestamp,
        },
        zephyrWallet,
        config: {
          mexcPaper: Boolean(env.MEXC_PAPER),
          zephyrPaper: Boolean(env.ZEPHYR_PAPER),
        },
        error: message,
      },
      { status: 500 },
    );
  }
}
