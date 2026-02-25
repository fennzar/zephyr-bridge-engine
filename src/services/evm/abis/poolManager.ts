import { parseAbiItem, type Abi, type AbiEvent } from "viem";

/** Predefined PoolManager events (single source of truth) */
export const poolManagerEvents = {
  Initialize: parseAbiItem(
    "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
  ) as AbiEvent,

  ModifyLiquidity: parseAbiItem(
    "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)"
  ) as AbiEvent,

  Swap: parseAbiItem(
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"
  ) as AbiEvent,

  Donate: parseAbiItem(
    "event Donate(bytes32 indexed id, address indexed sender, uint256 amount0, uint256 amount1)"
  ) as AbiEvent,
} as const;

/** Full ABI array (handy for watchContractEvent with eventName) */
export const poolManagerAbi = [
  poolManagerEvents.Initialize,
  poolManagerEvents.ModifyLiquidity,
  poolManagerEvents.Swap,
  poolManagerEvents.Donate,
] as const satisfies Abi;

export const POOL_MANAGER_EVENT_NAMES = {
  Initialize: "Initialize",
  ModifyLiquidity: "ModifyLiquidity",
  Swap: "Swap",
  Donate: "Donate",
} as const;

export type PoolManagerEventName = (typeof POOL_MANAGER_EVENT_NAMES)[keyof typeof POOL_MANAGER_EVENT_NAMES];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
