/**
 * CEX EVM client for ERC-20 operations.
 *
 * Reads CEX_ADDRESS + CEX_PK from env. Only handles USDT — the CEX
 * holds ZEPH.x (native Zephyr wallet) and USDT.x (ERC-20 on EVM).
 */

import { env, type NetworkEnv } from "@shared";
import { formatUnits, parseUnits, type Hex } from "viem";
import { makePublicClient } from "@services/evm/viemClient";
import { getTrackedTokens } from "@services/evm/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function getCexAddress(): `0x${string}` {
  const addr = env.CEX_ADDRESS ?? process.env.CEX_ADDRESS;
  if (!addr) throw new Error("CEX_ADDRESS not configured");
  return addr as `0x${string}`;
}

function getCexPrivateKey(): Hex {
  const raw = env.CEX_PK ?? process.env.CEX_PK;
  if (!raw) throw new Error("CEX_PK not configured");
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function findUsdt(): { address: `0x${string}`; decimals: number } | null {
  const network = env.ZEPHYR_ENV as NetworkEnv;
  const tokens = getTrackedTokens(network);
  const usdt = tokens.find((t) => t.symbol.toUpperCase() === "USDT");
  if (!usdt) return null;
  return { address: usdt.address as `0x${string}`, decimals: usdt.decimals };
}

/** Get USDT balance for the CEX EVM wallet. */
export async function getUsdtBalance(): Promise<number> {
  const usdt = findUsdt();
  if (!usdt) return 0;

  const network = env.ZEPHYR_ENV as NetworkEnv;
  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL || "";
  const client = makePublicClient(rpcUrl, network);

  const raw = (await client.readContract({
    address: usdt.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [getCexAddress()],
  })) as bigint;

  return Number(formatUnits(raw, usdt.decimals));
}

/** Transfer USDT from CEX wallet to a destination. Amount in human units. */
export async function transferUsdt(to: string, amountHuman: number): Promise<string> {
  const usdt = findUsdt();
  if (!usdt) throw new Error("USDT token not found in config");

  const rpcUrl = env.RPC_URL_HTTP || env.RPC_URL || "";
  const account = privateKeyToAccount(getCexPrivateKey());
  const chain = env.ZEPHYR_ENV === "local" ? foundry : undefined;

  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const amountWei = parseUnits(amountHuman.toString(), usdt.decimals);

  const hash = await wallet.writeContract({
    address: usdt.address,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to as `0x${string}`, amountWei],
  });

  return hash;
}

/** Get the CEX EVM address. */
export function getAddress(): string {
  return getCexAddress();
}
