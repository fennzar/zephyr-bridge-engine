import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type PublicClient,
} from "viem";

import { createLogger } from "@shared/logger";
import positionManagerAbi from "./abis/positionManager";

const log = createLogger("EVM:Positions");

type RawPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type PositionDetails = {
  tokenId: bigint;
  poolId: `0x${string}`;
  owner: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  hasSubscriber: boolean;
};

const poolKeyParameters = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

function normalizeTick(value: number): number {
  return value & 0x800000 ? value - 0x1000000 : value;
}

function decodePositionInfo(info: bigint) {
  const hasSubscriber = Number(info & 0xffn);
  const rawLower = Number((info >> 8n) & ((1n << 24n) - 1n));
  const rawUpper = Number((info >> (8n + 24n)) & ((1n << 24n) - 1n));
  return {
    hasSubscriber: hasSubscriber === 1,
    tickLower: normalizeTick(rawLower),
    tickUpper: normalizeTick(rawUpper),
  };
}

function poolIdFromKey(key: RawPoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(poolKeyParameters, [
      getAddress(key.currency0),
      getAddress(key.currency1),
      key.fee,
      key.tickSpacing,
      getAddress(key.hooks),
    ]),
  ) as `0x${string}`;
}

export async function fetchPositionDetails(
  client: PublicClient,
  positionManager: Address,
  tokenId: bigint,
): Promise<PositionDetails | null> {
  try {
    const [poolInfo, liquidityRaw, owner] = await Promise.all([
      client.readContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "getPoolAndPositionInfo",
        args: [tokenId],
      }) as Promise<[RawPoolKey, bigint]>,
      client.readContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "getPositionLiquidity",
        args: [tokenId],
      }) as Promise<bigint>,
      client.readContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "ownerOf",
        args: [tokenId],
      }) as Promise<Address>,
    ]);

    const [poolKey, infoPacked] = poolInfo;
    const decoded = decodePositionInfo(infoPacked);
    const poolId = poolIdFromKey(poolKey);

    return {
      tokenId,
      poolId,
      owner: getAddress(owner),
      tickLower: decoded.tickLower,
      tickUpper: decoded.tickUpper,
      liquidity: liquidityRaw,
      hasSubscriber: decoded.hasSubscriber,
    };
  } catch (error) {
    log.error(
      "Failed to fetch position details",
      { tokenId: tokenId.toString() },
      error,
    );
    return null;
  }
}
