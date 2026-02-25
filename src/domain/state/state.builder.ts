import { getReserveInfo } from "@services/zephyr/zephyrd";
import type { ReserveInfoResult } from "@services/zephyr/zephyrd";

import type { BridgeState, CexState, GlobalState, ZephyrState, EvmState } from "./types";
export type { GlobalState } from "./types";
import { buildZephyrState } from "./state.zephyr";
import { buildEvmState } from "./state.evm";
import { buildBridgeState } from "./state.bridge";
import { buildCexState } from "./state.cex";

export interface GlobalStateOverrides extends Partial<GlobalState> {
  zephyrRaw?: ReserveInfoResult;
}

export async function buildGlobalState(overrides?: GlobalStateOverrides): Promise<GlobalState> {
  let zephyr: ZephyrState;
  if (overrides?.zephyr) {
    zephyr = overrides.zephyr;
  } else {
    const raw = overrides?.zephyrRaw ?? (await getReserveInfo());
    zephyr = buildZephyrState(raw);
  }

  const evm: EvmState = overrides?.evm ?? (await buildEvmState());

  const bridge: BridgeState = overrides?.bridge ?? buildBridgeState();
  const cex: CexState = overrides?.cex ?? (await buildCexState());

  return { zephyr, bridge, evm, cex };
}
