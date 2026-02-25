import type { AssetId, OpType } from "@domain/types";
import { ASSET_STEPS } from "@domain/inventory/graph";

export type OperationSelection = OpType | "auto";

export type OperationMatrix = Partial<Record<AssetId, Partial<Record<AssetId, OpType[]>>>>;

export function buildOperationMatrix(assets: AssetId[]): OperationMatrix {
  const matrix: OperationMatrix = {};
  for (const asset of assets) {
    matrix[asset] = {};
  }

  for (const [asset, steps] of Object.entries(ASSET_STEPS) as Array<[AssetId, typeof ASSET_STEPS[AssetId]]>) {
    const row = matrix[asset] ?? (matrix[asset] = {});
    if (!steps) continue;
    for (const step of steps) {
      const list = row[step.to] ?? (row[step.to] = []);
      if (!list.includes(step.op)) {
        list.push(step.op);
      }
    }
  }

  return matrix;
}

export function operationsToAsset(matrix: OperationMatrix, from: AssetId, to: AssetId): OpType[] {
  return matrix[from]?.[to] ?? [];
}

export function hasAnyOperation(matrix: OperationMatrix, from: AssetId): boolean {
  const row = matrix[from];
  if (!row) return false;
  return Object.values(row).some((ops) => ops.length > 0);
}

export function hasOperation(matrix: OperationMatrix, from: AssetId, op: OpType): boolean {
  const row = matrix[from];
  if (!row) return false;
  return Object.values(row).some((ops) => ops.includes(op));
}
