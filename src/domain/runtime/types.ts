import type { AssetId, OpType } from "@domain/types";
import type { GlobalState } from "@domain/state/types";

export interface OperationRuntime<Context = unknown> {
  id: OpType;
  enabled(from: AssetId, to: AssetId, state: GlobalState): boolean;
  buildContext(from: AssetId, to: AssetId, state: GlobalState): Context | null;
  durationMs?(from: AssetId, to: AssetId, state: GlobalState): number;
}

export type OperationRegistry = Partial<Record<OpType, OperationRuntime>>;
