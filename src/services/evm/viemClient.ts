import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

export type ChainKey = "local" | "sepolia" | "mainnet";

export function chainFromKey(key: ChainKey) {
  switch (key) {
    case "mainnet":
      return mainnet;
    case "sepolia":
      return sepolia;
    case "local":
    default:
      return { ...sepolia, id: 31337, name: "anvil", rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } };
  }
}

export function makePublicClient(rpcUrl: string, key: ChainKey) {
  return createPublicClient({ chain: chainFromKey(key), transport: http(rpcUrl) });
}

export function makeWalletClient(rpcUrl: string, key: ChainKey, privateKey: Hex) {
  return createWalletClient({ chain: chainFromKey(key), transport: http(rpcUrl), account: privateKey });
}
