import { describe, expect, it } from "vitest";

import { quoteBridgeOperation } from "@domain/quoting/quoting.bridge";
import type { OperationQuoteRequest } from "@domain/quoting/types";
import { createBridgeContext, createMockBridgeState, createMockGlobalState } from "../../support/factories";

function wrapRequest(amountIn: bigint): OperationQuoteRequest {
  return {
    op: "wrap",
    from: "ZEPH.n",
    to: "WZEPH.e",
    amountIn,
  };
}

function unwrapRequest(amountIn: bigint): OperationQuoteRequest {
  return {
    op: "unwrap",
    from: "WZEPH.e",
    to: "ZEPH.n",
    amountIn,
  };
}

describe("quoteBridgeOperation", () => {
  it("returns null for unsupported operation", () => {
    const state = createMockGlobalState();
    const result = quoteBridgeOperation(
      { op: "swapEVM", from: "ZEPH.n", to: "WZEPH.e", amountIn: 1n },
      state,
      createBridgeContext("wrap", { bridge: state.bridge }),
    );
    expect(result).toBeNull();
  });

  it("returns null when bridge state is unavailable", () => {
    const state = createMockGlobalState();
    delete state.bridge;
    const context = createBridgeContext("wrap", {
      bridge: createMockBridgeState(),
    });
    const result = quoteBridgeOperation(wrapRequest(10n), state, context);
    expect(result).toBeNull();
  });

  it("quotes a wrap request with sufficient amount", () => {
    const state = createMockGlobalState();
    const context = createBridgeContext("wrap", {
      bridge: state.bridge,
      minAmountFrom: 1n,
      flatFeeFrom: 0n,
    });
    const request = wrapRequest(1_000_000_000_000n); // 1.0 considering 12 decimals

    const result = quoteBridgeOperation(request, state, context);
    expect(result).not.toBeNull();
    expect(result?.amountOut).toBe(1_000_000_000_000n);
    expect(result?.grossAmountOut).toBe(1_000_000_000_000n);
    expect(result?.policy?.bridge?.allowed).toBe(true);
    expect(result?.warnings).toBeUndefined();
  });

  it("flags wrap requests below the minimum amount", () => {
    const state = createMockGlobalState();
    const context = createBridgeContext("wrap", {
      bridge: state.bridge,
      minAmountFrom: 5_000_000_000_000n,
      flatFeeFrom: 0n,
    });

    const result = quoteBridgeOperation(wrapRequest(1_000_000_000_000n), state, context);
    expect(result?.policy?.bridge?.allowed).toBe(false);
    expect(result?.warnings).toContain("Amount is below bridge minimum");
  });

  it("quotes an unwrap request and subtracts bridge fee", () => {
    const state = createMockGlobalState();
    const context = createBridgeContext("unwrap", {
      bridge: state.bridge,
      minAmountFrom: 1n,
      flatFeeTo: 100_000_000_000n,
    });

    const request = unwrapRequest(1_000_000_000_000n);
    const result = quoteBridgeOperation(request, state, context);

    expect(result?.policy?.bridge?.allowed).toBe(true);
    expect(result?.amountOut).toBe(900_000_000_000n);
    expect(result?.feePaid).toBe(100_000_000_000n);
    expect(result?.feeAsset).toBe("to");
  });

  it("returns null when context direction does not match request", () => {
    const state = createMockGlobalState();
    const context = createBridgeContext("wrap", { bridge: state.bridge });
    const result = quoteBridgeOperation(unwrapRequest(1_000_000_000_000n), state, context);
    expect(result).toBeNull();
  });
});
