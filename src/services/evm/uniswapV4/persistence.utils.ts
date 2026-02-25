import { Prisma } from "@infra";
import { getAddress, type Address, type Hex } from "viem";
import type { NetworkEnv } from "@shared";
import { getTrackedTokenAddressIndex } from "../config";

type DbTokenLike = {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  key: string;
};

export type { DbTokenLike };

export function metadataToRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function decimalFromBigInt(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

export function buildPositionId(poolId: string, owner: string, tickLower: number, tickUpper: number, salt?: Hex): string {
  const suffix = salt && salt !== "0x" ? `::${salt.toLowerCase()}` : "";
  return `${poolId.toLowerCase()}::${owner.toLowerCase()}::${tickLower}::${tickUpper}${suffix}`;
}

export function parseTokenId(raw: Hex): bigint | undefined {
  if (!raw || raw === "0x") return undefined;
  try {
    return BigInt(raw);
  } catch {
    return undefined;
  }
}

export function toLowerAddress(address: Address | string): string {
  const value = address as string;
  if (!value.startsWith("0x")) {
    return `0x${value.toLowerCase()}`;
  }

  if (value.length === 42) {
    // 20 byte address – normalize with checksum first.
    return getAddress(value as Address).toLowerCase();
  }

  if (value.length === 66) {
    // 32 byte pool id – downcase without checksum enforcement.
    return (`0x${value.slice(2).toLowerCase()}`) as string;
  }

  return value.toLowerCase();
}

export function serializePoolKey(
  poolId: string,
  token0: string,
  token1: string,
  fee: number,
  tickSpacing: number,
  hooks: Address,
): string {
  return [poolId.toLowerCase(), token0.toLowerCase(), token1.toLowerCase(), fee, tickSpacing, hooks.toLowerCase()].join(
    "|",
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && (error as { code: string }).code === "P2002") return true;
  return false;
}

export function indexTrackedTokens(network: NetworkEnv): Record<string, DbTokenLike> {
  const tokens = getTrackedTokenAddressIndex(network);
  return Object.entries(tokens).reduce<Record<string, DbTokenLike>>((map, [address, token]) => {
    map[address] = {
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol,
      name: token.name,
      key: token.key,
    };
    return map;
  }, {});
}
