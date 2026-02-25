import {
  getAddress,
  parseAbi,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { privateKeyToAccount } from "viem/accounts";
import type { NetworkEnv } from "@shared";
import { getNetworkConfig } from "./config";
import { chainFromKey } from "./viemClient";

// ============================================================
// ABIs used by approval functions
// ============================================================

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
  "function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

/**
 * Ensure an ERC20 approval is in place for `spenderAddress` to spend at least `amount`
 * of `tokenAddress` on behalf of the account.
 */
export async function ensureApproval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: ReturnType<typeof privateKeyToAccount>,
  network: NetworkEnv,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
): Promise<void> {
  const currentAllowance = (await publicClient.readContract({
    address: getAddress(tokenAddress),
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, getAddress(spenderAddress)],
  })) as bigint;

  if (currentAllowance < amount) {
    const hash = await walletClient.writeContract({
      address: getAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: "approve",
      args: [getAddress(spenderAddress), amount],
      account,
      chain: chainFromKey(network),
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }
}

/**
 * Ensure a two-step Permit2 approval is in place:
 *   1. ERC20 approve token → Permit2 (max allowance)
 *   2. Permit2 approve token → spender (position manager)
 */
export async function ensurePermit2Approval(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: ReturnType<typeof privateKeyToAccount>,
  network: NetworkEnv,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
): Promise<void> {
  const config = getNetworkConfig(network);
  const permit2Address = config.contracts?.permit2;
  if (!permit2Address) {
    throw new Error("Permit2 not configured for this network");
  }

  // Step 1: ERC20 approve token → Permit2 (max allowance)
  const MAX_UINT256 = 2n ** 256n - 1n;
  await ensureApproval(publicClient, walletClient, account, network, tokenAddress, permit2Address, MAX_UINT256);

  // Step 2: Permit2 approve token → spender (position manager)
  const MAX_UINT160 = 2n ** 160n - 1n;
  const PERMIT2_EXPIRATION = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days

  // Check current Permit2 allowance
  const allowanceResult = (await publicClient.readContract({
    address: getAddress(permit2Address),
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [account.address, getAddress(tokenAddress), getAddress(spenderAddress)],
  })) as unknown as [bigint, bigint, bigint]; // [amount, expiration, nonce]

  const currentAmount = BigInt(allowanceResult[0]);
  const currentExpiration = BigInt(allowanceResult[1]);
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (currentAmount < amount || currentExpiration <= now) {
    const hash = await walletClient.writeContract({
      address: getAddress(permit2Address),
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [getAddress(tokenAddress), getAddress(spenderAddress), MAX_UINT160, PERMIT2_EXPIRATION],
      account,
      chain: chainFromKey(network),
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }
}
