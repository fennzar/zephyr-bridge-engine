import type { AssetId } from "@domain/types";
import type { GlobalState } from "@domain/state/types";
import type { OperationRuntime } from "@domain/runtime/types";
import { toRatio } from "@shared/math";

function isMintPair(from: AssetId, to: AssetId): boolean {
  return (from === "ZEPH.n" && (to === "ZSD.n" || to === "ZRS.n")) || (from === "ZSD.n" && to === "ZYS.n");
}

export interface NativeOperationContext {
  kind: "mint" | "redeem";
  from: AssetId;
  to: AssetId;
  rate: bigint;
  feeBps: number;
  reserveRatio?: number;
}

export const nativeMintRuntime: OperationRuntime<NativeOperationContext> = {
  id: "nativeMint",

  enabled(from: AssetId, to: AssetId, st: GlobalState) {
    if (!isMintPair(from, to)) return false;
    const { reserve } = st.zephyr;

    if (from === "ZEPH.n" && to === "ZSD.n") return reserve.policy.zsd.mintable;
    if (from === "ZEPH.n" && to === "ZRS.n") return reserve.policy.zrs.mintable;
    if (from === "ZSD.n" && to === "ZYS.n") return true; // always
    return false;
  },

  buildContext(from: AssetId, to: AssetId, st: GlobalState): NativeOperationContext | null {
    const { reserve, feesBps } = st.zephyr;

    if (from === "ZEPH.n" && to === "ZSD.n") {
      const rate = toRatio(reserve.rates.zsd.mint);
      if (rate === 0n) return null;
      return {
        kind: "mint",
        from,
        to,
        rate,
        feeBps: feesBps.convertZSD,
      };
    }

    if (from === "ZEPH.n" && to === "ZRS.n") {
      const rate = toRatio(reserve.rates.zrs.mint);
      if (rate === 0n) return null;
      return {
        kind: "mint",
        from,
        to,
        rate,
        feeBps: feesBps.convertZRS,
      };
    }

    if (from === "ZSD.n" && to === "ZYS.n") {
      const rate = toRatio(reserve.rates.zys.mint);
      if (rate === 0n) return null;
      return {
        kind: "mint",
        from,
        to,
        rate,
        feeBps: feesBps.convertZYS,
      };
    }

    return null;
  },

  durationMs(_from: AssetId, _to: AssetId, _st: GlobalState) {
    // native conversions: you marked them "instant" but subject to 10‑block unlock for moving funds again.
    return 0; // execution time; settlement constraints handled elsewhere
  },
};

function isRedeemPair(from: AssetId, to: AssetId): boolean {
  return (
    (from === "ZSD.n" && to === "ZEPH.n") ||
    (from === "ZRS.n" && to === "ZEPH.n") ||
    (from === "ZYS.n" && to === "ZSD.n")
  );
}

export const nativeRedeemRuntime: OperationRuntime = {
  id: "nativeRedeem",

  enabled(from: AssetId, to: AssetId, st: GlobalState) {
    if (!isRedeemPair(from, to)) return false;
    const { reserve } = st.zephyr;

    if (from === "ZSD.n" && to === "ZEPH.n") return true; // always allowed
    if (from === "ZRS.n" && to === "ZEPH.n") return reserve.policy.zrs.redeemable;
    if (from === "ZYS.n" && to === "ZSD.n") return true; // always allowed
    return false;
  },

  buildContext(from: AssetId, to: AssetId, st: GlobalState): NativeOperationContext | null {
    const { reserve, feesBps } = st.zephyr;

    if (from === "ZSD.n" && to === "ZEPH.n") {
      const rate = toRatio(reserve.rates.zsd.redeem);
      if (rate === 0n) return null;
      const rr = reserve.reserveRatio;
      return {
        kind: "redeem",
        from,
        to,
        rate,
        feeBps: feesBps.convertZSD,
        reserveRatio: rr,
      };
    }

    if (from === "ZRS.n" && to === "ZEPH.n") {
      const rate = toRatio(reserve.rates.zrs.redeem);
      if (rate === 0n) return null;
      return {
        kind: "redeem",
        from,
        to,
        rate,
        feeBps: feesBps.convertZRS,
      };
    }

    if (from === "ZYS.n" && to === "ZSD.n") {
      const rate = toRatio(reserve.rates.zys.redeem);
      if (rate === 0n) return null;
      return {
        kind: "redeem",
        from,
        to,
        rate,
        feeBps: feesBps.convertZYS,
      };
    }

    return null;
  },

  durationMs(_from: AssetId, _to: AssetId, _st: GlobalState) {
    return 0; // conversion itself is instant (unlock handled elsewhere)
  },
};
