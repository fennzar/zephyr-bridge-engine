import type { AssetId, OpType } from "@domain/types";
import { buildOperationMatrix, type OperationMatrix, type OperationSelection } from "../shared/operations";

export const RUNTIME_ASSETS: AssetId[] = [
  "USDT.e",
  "WZSD.e",
  "WZEPH.e",
  "WZRS.e",
  "WZYS.e",
  "ZSD.n",
  "ZEPH.n",
  "ZRS.n",
  "ZYS.n",
  "ZEPH.x",
  "USDT.x",
];

export const RUNTIME_OPERATIONS = ["swapEVM", "wrap", "unwrap", "nativeMint", "nativeRedeem", "deposit", "withdraw", "tradeCEX"] as OpType[];
export const RUNTIME_OPERATION_CHOICES = ["auto", ...RUNTIME_OPERATIONS] as OperationSelection[];

export const RUNTIME_OPERATIONS_MATRIX: OperationMatrix = buildOperationMatrix(RUNTIME_ASSETS);
