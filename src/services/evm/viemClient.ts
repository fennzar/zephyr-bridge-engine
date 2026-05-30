import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { mainnet, sepolia } from "viem/chains";

export type ChainKey = "local" | "sepolia" | "mainnet";

// Local devnet chainId is configurable (collision-free 271337 dev / 271338 testnet-v2).
// Read it from env so signed txs carry the chainId the Anvil node actually runs on —
// hardcoding 31337 here caused "invalid chain id for signer" once the devnet moved off 31337.
function localChainId(): number {
  const raw = process.env.EVM_CHAIN_ID_LOCAL ?? process.env.EVM_CHAIN_ID;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 271337;
}

export function chainFromKey(key: ChainKey) {
  switch (key) {
    case "mainnet":
      return mainnet;
    case "sepolia":
      return sepolia;
    case "local":
    default:
      return { ...sepolia, id: localChainId(), name: "anvil", rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } };
  }
}

export function makePublicClient(rpcUrl: string, key: ChainKey) {
  return createPublicClient({ chain: chainFromKey(key), transport: http(rpcUrl) });
}

export function makeWalletClient(rpcUrl: string, key: ChainKey, privateKey: Hex) {
  return createWalletClient({ chain: chainFromKey(key), transport: http(rpcUrl), account: privateKey });
}
