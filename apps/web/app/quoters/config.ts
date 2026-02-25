import type { AssetId, OpType } from "@domain/types";
import { buildOperationMatrix, type OperationMatrix, type OperationSelection } from "../shared/operations";

export const QUOTER_SUPPORTED_OPS: OpType[] = [
  "swapEVM",
  "nativeMint",
  "nativeRedeem",
  "wrap",
  "unwrap",
  "tradeCEX",
];

export const QUOTER_ASSETS: AssetId[] = [
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

export const QUOTER_OPERATION_CHOICES = ["auto", ...QUOTER_SUPPORTED_OPS] as OperationSelection[];

export const QUOTER_OPERATIONS_MATRIX: OperationMatrix = buildOperationMatrix(QUOTER_ASSETS);
