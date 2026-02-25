import type { AssetId } from "@domain/types";
import type { GlobalState } from "@domain/state/types";
import type { OperationRuntime } from "@domain/runtime/types";
import { assetDecimals } from "@domain/assets/decimals";

/**
 * Bridge timing constants.
 * Default: 10 blocks @ ~2 min/block = ~20 minutes.
 */
const DEFAULT_BRIDGE_BLOCKS = 10;
const ZEPHYR_BLOCK_TIME_MS = 2 * 60 * 1000; // ~2 minutes per block
const DEFAULT_BRIDGE_DURATION_MS = DEFAULT_BRIDGE_BLOCKS * ZEPHYR_BLOCK_TIME_MS; // ~20 minutes

export interface BridgePair {
  native: AssetId;
  wrapped: AssetId;
}

export interface BridgeOperationContext {
  direction: "wrap" | "unwrap";
  bridge: NonNullable<GlobalState["bridge"]>;
  from: AssetId;
  to: AssetId;
  pair: BridgePair;
  fromDecimals: number;
  toDecimals: number;
  minAmountFrom: bigint;
  flatFeeFrom?: bigint;
  flatFeeTo?: bigint;
}

const BRIDGE_PAIRS: BridgePair[] = [
  { native: "ZEPH.n", wrapped: "WZEPH.e" },
  { native: "ZSD.n", wrapped: "WZSD.e" },
  { native: "ZRS.n", wrapped: "WZRS.e" },
  { native: "ZYS.n", wrapped: "WZYS.e" },
];

/**
 * Runtime for wrapping native -> wrapped assets via the Zephyr bridge.
 * Duration: ~20 min (10 blocks) default.
 */
export const wrapRuntime: OperationRuntime<BridgeOperationContext> = {
  id: "wrap",

  enabled(_from: AssetId, _to: AssetId, _st: GlobalState): boolean {
    if (!_st.bridge) return false;
    const pair = findPair(_from, _to);
    return Boolean(pair && isWrapPair(pair, _from, _to));
  },

  buildContext(_from: AssetId, _to: AssetId, st: GlobalState): BridgeOperationContext | null {
    if (!st.bridge) return null;
    const pair = findPair(_from, _to);
    if (!pair || !isWrapPair(pair, _from, _to)) return null;

    const fromDecimals = assetDecimals(_from);
    const toDecimals = assetDecimals(_to);
    const minAmountFrom = toUnits(st.bridge.wrap.minAmount, fromDecimals);
    const flatFeeFrom = toUnits(st.bridge.wrap.gasFee, fromDecimals);

    return {
      direction: "wrap",
      bridge: st.bridge,
      from: _from,
      to: _to,
      pair,
      fromDecimals,
      toDecimals,
      minAmountFrom,
      flatFeeFrom,
    };
  },

  durationMs(_from: AssetId, _to: AssetId, _st: GlobalState): number {
    return DEFAULT_BRIDGE_DURATION_MS;
  },
};

function findPair(from: AssetId, to: AssetId): BridgePair | null {
  return BRIDGE_PAIRS.find((pair) => {
    return (
      (pair.native === from && pair.wrapped === to) ||
      (pair.native === to && pair.wrapped === from)
    );
  }) ?? null;
}

function isWrapPair(pair: BridgePair, from: AssetId, to: AssetId): boolean {
  return pair.native === from && pair.wrapped === to;
}

function isUnwrapPair(pair: BridgePair, from: AssetId, to: AssetId): boolean {
  return pair.wrapped === from && pair.native === to;
}

function toUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const scale = 10n ** BigInt(decimals);
  return BigInt(Math.round(amount * Number(scale))); // potential precision for large decimals
}

/**
 * Runtime for unwrapping wrapped -> native assets via the Zephyr bridge.
 * Duration: ~20 min (10 blocks) default.
 */
export const unwrapRuntime: OperationRuntime<BridgeOperationContext> = {
  id: "unwrap",

  enabled(_from: AssetId, _to: AssetId, _st: GlobalState): boolean {
    if (!_st.bridge) return false;
    const pair = findPair(_from, _to);
    return Boolean(pair && isUnwrapPair(pair, _from, _to));
  },

  buildContext(_from: AssetId, _to: AssetId, st: GlobalState): BridgeOperationContext | null {
    if (!st.bridge) return null;
    const pair = findPair(_from, _to);
    if (!pair || !isUnwrapPair(pair, _from, _to)) return null;

    const fromDecimals = assetDecimals(_from);
    const toDecimals = assetDecimals(_to);
    const minAmountFrom = toUnits(st.bridge.unwrap.minAmount, fromDecimals);
    const flatFeeTo = toUnits(st.bridge.unwrap.bridgeFee, toDecimals);

    return {
      direction: "unwrap",
      bridge: st.bridge,
      from: _from,
      to: _to,
      pair,
      fromDecimals,
      toDecimals,
      minAmountFrom,
      flatFeeTo,
    };
  },

  durationMs(_from: AssetId, _to: AssetId, _st: GlobalState): number {
    return DEFAULT_BRIDGE_DURATION_MS;
  },
};
