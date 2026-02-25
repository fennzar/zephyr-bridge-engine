import type { BridgeState } from "./types";

const DEFAULT_BRIDGE_STATE: BridgeState = {
  wrap: {
    gasFee: 0,
    minAmount: 0,
  },
  unwrap: {
    bridgeFee: 0.01,
    minAmount: 0,
  },
};

export type BridgeStateOverrides = Partial<BridgeState>;

export function buildBridgeState(overrides?: BridgeStateOverrides): BridgeState {
  if (!overrides) return DEFAULT_BRIDGE_STATE;

  return {
    wrap: {
      gasFee: overrides.wrap?.gasFee ?? DEFAULT_BRIDGE_STATE.wrap.gasFee,
      minAmount: overrides.wrap?.minAmount ?? DEFAULT_BRIDGE_STATE.wrap.minAmount,
    },
    unwrap: {
      bridgeFee: overrides.unwrap?.bridgeFee ?? DEFAULT_BRIDGE_STATE.unwrap.bridgeFee,
      minAmount: overrides.unwrap?.minAmount ?? DEFAULT_BRIDGE_STATE.unwrap.minAmount,
    },
  };
}
