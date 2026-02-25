import type { AssetId } from "./assets";
import type { Venue } from "./assets";

export type OpType =
  | "swapEVM"
  | "wrap"
  | "unwrap"
  | "nativeMint"
  | "nativeRedeem"
  | "deposit"
  | "withdraw"
  | "tradeCEX"
  // LP operations
  | "lpMint"
  | "lpBurn"
  | "lpCollect";

export interface OperationStep {
  from: AssetId;
  to: AssetId;
  op: OpType;
  venue: Venue;
}
