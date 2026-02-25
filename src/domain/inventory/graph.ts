import type { AssetId, Venue } from "@domain/types";
import type { OperationStep, OpType } from "@domain/core/operations";

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

const steps = <T extends OperationStep[]>(value: T): readonly OperationStep[] => freeze(value.slice());

export const ASSET_STEPS: Record<AssetId, readonly OperationStep[]> = {
  "ZEPH.n": steps([
    { from: "ZEPH.n", to: "WZEPH.e", op: "wrap", venue: "evm" },
    { from: "ZEPH.n", to: "ZEPH.x", op: "deposit", venue: "cex" },
    { from: "ZEPH.n", to: "ZSD.n", op: "nativeMint", venue: "native" },
    { from: "ZEPH.n", to: "ZRS.n", op: "nativeMint", venue: "native" },
  ]),
  "ZSD.n": steps([
    { from: "ZSD.n", to: "WZSD.e", op: "wrap", venue: "evm" },
    { from: "ZSD.n", to: "ZEPH.n", op: "nativeRedeem", venue: "native" },
    { from: "ZSD.n", to: "ZYS.n", op: "nativeMint", venue: "native" },
  ]),
  "ZRS.n": steps([
    { from: "ZRS.n", to: "WZRS.e", op: "wrap", venue: "evm" },
    { from: "ZRS.n", to: "ZEPH.n", op: "nativeRedeem", venue: "native" },
  ]),
  "ZYS.n": steps([
    { from: "ZYS.n", to: "WZYS.e", op: "wrap", venue: "evm" },
    { from: "ZYS.n", to: "ZSD.n", op: "nativeRedeem", venue: "native" },
  ]),
  "WZEPH.e": steps([
    { from: "WZEPH.e", to: "WZSD.e", op: "swapEVM", venue: "evm" },
    { from: "WZEPH.e", to: "WZRS.e", op: "swapEVM", venue: "evm" },
    { from: "WZEPH.e", to: "ZEPH.n", op: "unwrap", venue: "native" },
  ]),
  "WZSD.e": steps([
    { from: "WZSD.e", to: "USDT.e", op: "swapEVM", venue: "evm" },
    { from: "WZSD.e", to: "WZEPH.e", op: "swapEVM", venue: "evm" },
    { from: "WZSD.e", to: "WZYS.e", op: "swapEVM", venue: "evm" },
    { from: "WZSD.e", to: "ZSD.n", op: "unwrap", venue: "native" },
  ]),
  "WZRS.e": steps([
    { from: "WZRS.e", to: "WZEPH.e", op: "swapEVM", venue: "evm" },
    { from: "WZRS.e", to: "ZRS.n", op: "unwrap", venue: "native" },
  ]),
  "WZYS.e": steps([
    { from: "WZYS.e", to: "WZSD.e", op: "swapEVM", venue: "evm" },
    { from: "WZYS.e", to: "ZYS.n", op: "unwrap", venue: "native" },
  ]),
  "USDT.e": steps([
    { from: "USDT.e", to: "WZSD.e", op: "swapEVM", venue: "evm" },
    { from: "USDT.e", to: "ETH.e", op: "swapEVM", venue: "evm" },
    { from: "USDT.e", to: "USDT.x", op: "deposit", venue: "cex" },
  ]),
  "ETH.e": steps([
    { from: "ETH.e", to: "USDT.e", op: "swapEVM", venue: "evm" },
  ]),
  "ZEPH.x": steps([
    { from: "ZEPH.x", to: "USDT.x", op: "tradeCEX", venue: "cex" },
    { from: "ZEPH.x", to: "ZEPH.n", op: "withdraw", venue: "native" },
  ]),
  "USDT.x": steps([
    { from: "USDT.x", to: "ZEPH.x", op: "tradeCEX", venue: "cex" },
    { from: "USDT.x", to: "USDT.e", op: "withdraw", venue: "evm" },
  ]),
};

export type PathStep = OperationStep;

export interface AssetPath {
  assets: AssetId[];
  steps: OperationStep[];
}

function listOutgoing(assetId: AssetId): readonly OperationStep[] {
  return ASSET_STEPS[assetId] ?? [];
}

export function findAssetPaths(from: AssetId, to: AssetId, maxDepth?: number): AssetPath[] {
  if (!ASSET_STEPS[from] || !ASSET_STEPS[to]) return [];

  if (from === to) return [{ assets: [from], steps: [] }];

  const depthCap = maxDepth ?? Object.keys(ASSET_STEPS).length;
  const paths: AssetPath[] = [];
  const stackAssets: AssetId[] = [from];
  const stackSteps: OperationStep[] = [];
  const visited = new Set<AssetId>([from]);

  const dfs = (current: AssetId, depth: number) => {
    if (depth >= depthCap) return;

    for (const step of listOutgoing(current)) {
      if (visited.has(step.to)) continue;

      visited.add(step.to);
      stackAssets.push(step.to);
      stackSteps.push(step);

      if (step.to === to) {
        paths.push({ assets: [...stackAssets], steps: [...stackSteps] });
      } else {
        dfs(step.to, depth + 1);
      }

      visited.delete(step.to);
      stackAssets.pop();
      stackSteps.pop();
    }
  };

  dfs(from, 0);
  return paths.sort((a, b) => a.steps.length - b.steps.length);
}

export interface AssetPathToTarget {
  source: AssetId;
  path: AssetPath;
}

export function findPathsToAsset(target: AssetId, maxDepth?: number): AssetPathToTarget[] {
  if (!ASSET_STEPS[target]) return [];

  const results: AssetPathToTarget[] = [
    {
      source: target,
      path: {
        assets: [target],
        steps: [],
      },
    },
  ];

  for (const candidate of Object.keys(ASSET_STEPS) as AssetId[]) {
    if (candidate === target) continue;

    const paths = findAssetPaths(candidate, target, maxDepth);
    for (const path of paths) {
      results.push({ source: candidate, path });
    }
  }

  return results.sort((a, b) => {
    const hopDelta = a.path.steps.length - b.path.steps.length;
    if (hopDelta !== 0) return hopDelta;
    return a.source.localeCompare(b.source);
  });
}

export function describeOperation(step: OperationStep): string {
  return `${step.op}@${step.venue}:${step.from}->${step.to}`;
}

export function listOperationsForAsset(assetId: AssetId): OpType[] {
  const seen = new Set<OpType>();
  for (const step of listOutgoing(assetId)) {
    seen.add(step.op);
  }
  return Array.from(seen);
}
