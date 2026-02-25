import { mapReserveInfo } from "@domain/zephyr/reserve";
import type { ReserveInfoResult } from "@services/zephyr/zephyrd";

import type { ZephyrState } from "./types";

export function buildZephyrState(raw: ReserveInfoResult): ZephyrState {
  const reserve = mapReserveInfo(raw);
  if (!reserve) throw new Error("Invalid ReserveInfoResult");

  return {
    height: reserve.height,
    reserve,
    feesBps: {
      convertZSD: 10, // 0.10%
      convertZRS: 100, // 1.00%
      convertZYS: 10, // 0.10%
    },
    durations: {
      unlockBlocks: 10,
      estUnlockTimeMs: 20 * 60 * 1000,
    },
  };
}
