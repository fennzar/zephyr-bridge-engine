import type { OperationRegistry } from "@domain/runtime/types";
import { nativeMintRuntime, nativeRedeemRuntime } from "@domain/runtime/runtime.zephyr";
import { swapEvmRuntime } from "@domain/runtime/runtime.evm";
import { wrapRuntime, unwrapRuntime } from "@domain/runtime/runtime.bridge";
import { depositRuntime, tradeCexRuntime, withdrawRuntime } from "@domain/runtime/runtime.cex";

// Registry to plug your adapters into.
// Bridge/EVM/CEX entries are scaffolds – fill in implementation details as runtimes mature.
export const OP_RUNTIME: OperationRegistry = {
  nativeMint: nativeMintRuntime,
  nativeRedeem: nativeRedeemRuntime,
  swapEVM: swapEvmRuntime,
  wrap: wrapRuntime,
  unwrap: unwrapRuntime,
  deposit: depositRuntime,
  withdraw: withdrawRuntime,
  tradeCEX: tradeCexRuntime,
};
