/**
 * CEX Zephyr Wallet RPC client.
 *
 * Thin wrapper around the wallet-cex container (port 48772).
 * Only needs ZEPH balance reads and transfers — no subaddresses,
 * no multi-account, no conversions.
 */

import { env } from "@shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletRpcResponse<T> {
  id: string;
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
}

interface GetBalanceResult {
  balance: string;
  unlocked_balance: string;
}

interface TransferResult {
  tx_hash: string;
  fee: string;
}

// ---------------------------------------------------------------------------
// RPC helper
// ---------------------------------------------------------------------------

const HEADERS: HeadersInit = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

function getRpcUrl(): string {
  return env.CEX_WALLET_RPC_URL ?? "http://localhost:48772/json_rpc";
}

async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const url = getRpcUrl();
  const payload = {
    jsonrpc: "2.0",
    id: "0",
    method,
    params: params ?? {},
  };

  const response = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CEX wallet RPC ${method} failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as WalletRpcResponse<T>;

  if (data.error) {
    throw new Error(`CEX wallet RPC error: ${data.error.code} ${data.error.message}`);
  }

  if (data.result === undefined) {
    throw new Error(`CEX wallet RPC ${method}: no result returned`);
  }

  return data.result;
}

function parseBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ATOMIC = 1e12;

/** Get ZEPH balance in human-readable units. */
export async function getZephBalance(): Promise<{ total: number; unlocked: number }> {
  const result = await rpc<GetBalanceResult>("get_balance", {
    account_index: 0,
    all_assets: true,
  });
  return {
    total: Number(parseBigInt(result.balance)) / ATOMIC,
    unlocked: Number(parseBigInt(result.unlocked_balance)) / ATOMIC,
  };
}

/** Get the primary address for this wallet. */
export async function getAddress(): Promise<string> {
  const result = await rpc<{ address: string }>("get_address", { account_index: 0 });
  return result.address;
}

/** Transfer ZEPH to a destination address. Amount in atomic units. */
export async function transfer(
  destinationAddress: string,
  amountAtomic: bigint,
): Promise<{ txHash: string; fee: bigint }> {
  const result = await rpc<TransferResult>("transfer", {
    destinations: [{ address: destinationAddress, amount: amountAtomic.toString() }],
    source_asset: "ZPH",
    destination_asset: "ZPH",
    get_tx_key: true,
  });
  return {
    txHash: result.tx_hash,
    fee: parseBigInt(result.fee),
  };
}

/** Check if the wallet RPC is reachable and ready. */
export async function isReady(): Promise<boolean> {
  try {
    await rpc<{ height: number }>("get_height");
    return true;
  } catch {
    return false;
  }
}
