import { formatUnits } from "viem";

import { env, type NetworkEnv } from "@shared";
import type { BalanceSnapshot } from "@domain/inventory/types";
import { readPaperBalances } from "@services/paperBalanceStore";
import { getTrackedTokens } from "@services/evm/config";
import { makePublicClient } from "@services/evm/viemClient";
import { createZephyrWalletClient } from "@services/zephyr/wallet";

const ERC20_BALANCE_OF_ABI = [
  {
    constant: true,
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function parseBalanceNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function loadBalanceSnapshot(): Promise<BalanceSnapshot> {
  const network = env.ZEPHYR_ENV as NetworkEnv;
  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL || "";
  const address = env.EVM_WALLET_ADDRESS ?? process.env.EVM_WALLET_ADDRESS ?? null;

  const paperStore = await readPaperBalances().catch(() => null);

  const snapshot: BalanceSnapshot = {
    config: {
      mexcPaper: Boolean(env.MEXC_PAPER),
      zephyrPaper: Boolean(env.ZEPHYR_PAPER),
    },
    evm: {
      status: "off",
      nativeSymbol: "ETH",
      native: 0,
      tokens: {},
    },
    paper: paperStore
      ? {
          updatedAt: paperStore.updatedAt ?? null,
          mexc: paperStore.mexc ?? {},
          zephyr: paperStore.zephyr ?? {},
        }
      : null,
  };

  if (!address) {
    snapshot.evm.error = "EVM_WALLET_ADDRESS not configured";
    return snapshot;
  }
  if (!rpcUrl) {
    snapshot.evm.error = "RPC_URL_HTTP not configured";
    return snapshot;
  }

  try {
    const client = makePublicClient(rpcUrl, network);
    const hexAddress = address as `0x${string}`;
    const [nativeRaw, tokenBalances] = await Promise.all([
      client.getBalance({ address: hexAddress }),
      Promise.all(
        getTrackedTokens(network).map(async (token) => {
          try {
            const raw = (await client.readContract({
              address: token.address as `0x${string}`,
              abi: ERC20_BALANCE_OF_ABI,
              functionName: "balanceOf",
              args: [hexAddress],
            })) as bigint;
            const formatted = formatUnits(raw, token.decimals);
            return {
              symbol: token.symbol.toUpperCase(),
              balance: parseBalanceNumber(formatted),
              error: null as string | null,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to fetch";
            return {
              symbol: token.symbol.toUpperCase(),
              balance: 0,
              error: message,
            };
          }
        }),
      ),
    ]);

    snapshot.evm.native = parseBalanceNumber(formatUnits(nativeRaw, 18));
    snapshot.evm.tokens = {};
    for (const token of tokenBalances) {
      snapshot.evm.tokens[token.symbol] = token.balance;
      if (token.error) {
        if (!snapshot.evm.error) snapshot.evm.error = token.error;
      }
    }
    snapshot.evm.status = "ok";
    snapshot.evm.error = undefined;
  } catch (error) {
    snapshot.evm.status = "error";
    snapshot.evm.error = error instanceof Error ? error.message : "Failed to load EVM balances";
  }

  // Load CEX wallet balances (real wallets) when MEXC_PAPER is set
  if (env.MEXC_PAPER) {
    try {
      const { getCexBalances } = await import("@services/cex/client");
      const cexBals = await getCexBalances();
      snapshot.cex = {
        status: "ok",
        balances: cexBals,
      };
    } catch (error) {
      snapshot.cex = {
        status: "error",
        balances: null,
        error: error instanceof Error ? error.message : "Failed to load CEX wallet balances",
      };
    }
  }

  // Load real Zephyr wallet balances when not in paper mode
  if (!env.ZEPHYR_PAPER) {
    try {
      const wallet = createZephyrWalletClient();
      const [address, bal] = await Promise.all([wallet.getAddress(), wallet.getBalance()]);
      const ATOMIC = 1e12;
      snapshot.zephyr = {
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
      snapshot.zephyr = {
        status: "error",
        address: null,
        balances: null,
        error: error instanceof Error ? error.message : "Failed to load Zephyr wallet balances",
      };
    }
  }

  return snapshot;
}
