import type { ArbAsset } from "@domain/arbitrage";
import { formatBps } from "@shared/format";

import { ArbBadge } from "./ArbLayout";

export function AssetIndexNav({ assets }: { assets: ArbAsset[] }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {assets.map((asset) => {
        const color = asset.status.mode === "aligned" ? "#9AA0AA" : asset.status.mode === "premium" ? "#16c784" : "#f45b69";
        const gap = formatBps(asset.status.gapBps ?? Number.NaN);
        const label = `${asset.asset} (${gap})`;
        return (
          <a key={asset.asset} href={`#asset-${asset.asset.toLowerCase()}`} style={{ textDecoration: "none" }}>
            <ArbBadge text={label} color={color} subtle mono />
          </a>
        );
      })}
    </div>
  );
}
