import type { FC } from "react";
import type { AssetId } from "@domain/types";
import type { SvgProps } from "./LogoSvgs";
import {
  ZephLogo,
  ZsdLogo,
  ZrsLogo,
  ZysLogo,
  WZephLogo,
  WZsdLogo,
  WZrsLogo,
  WZysLogo,
  UsdtLogo,
  UsdcLogo,
  EthLogo,
} from "./LogoSvgs";

const ASSET_LOGOS: Partial<Record<string, FC<SvgProps>>> = {
  ZEPH: ZephLogo,
  "ZEPH.n": ZephLogo,
  "ZEPH.x": ZephLogo,
  ZSD: ZsdLogo,
  "ZSD.n": ZsdLogo,
  ZRS: ZrsLogo,
  "ZRS.n": ZrsLogo,
  ZYS: ZysLogo,
  "ZYS.n": ZysLogo,
  "WZEPH.e": WZephLogo,
  "WZSD.e": WZsdLogo,
  "WZRS.e": WZrsLogo,
  "WZYS.e": WZysLogo,
  "USDT.e": UsdtLogo,
  "USDT.x": UsdtLogo,
  USDT: UsdtLogo,
  USDC: UsdcLogo,
  "USDC.e": UsdcLogo,
  "ETH.e": EthLogo,
  ETH: EthLogo,
};

const VARIANT_ACCENTS: Record<string, string> = {
  ".e": "rgba(129, 140, 248, 0.18)",
  ".n": "rgba(157, 98, 255, 0.18)",
  ".x": "rgba(249, 115, 22, 0.18)",
};

const VARIANT_BORDER: Record<string, string> = {
  ".e": "rgba(129, 140, 248, 0.45)",
  ".n": "rgba(157, 98, 255, 0.45)",
  ".x": "rgba(249, 115, 22, 0.45)",
};

export function stripVariantSuffix(asset: string): string {
  return asset.replace(/\.(e|n|x)$/i, "");
}

function getVariant(asset: string): string | null {
  const match = asset.match(/\.(e|n|x)$/i);
  return match ? `.${match[1]}` : null;
}

function formatAmount(value: number | string | null | undefined, digits: number, compact: boolean): string | null {
  if (value == null) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  if (compact) {
    const abs = Math.abs(numeric);
    const formatter = (divisor: number, suffix: string) => `${(numeric / divisor).toFixed(digits)}${suffix}`;
    if (abs >= 1_000_000_000) return formatter(1_000_000_000, "B");
    if (abs >= 1_000_000) return formatter(1_000_000, "M");
    if (abs >= 1_000) return formatter(1_000, "k");
  }
  return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function getAssetLogo(asset: string | null): FC<SvgProps> | null {
  if (!asset) return null;
  return ASSET_LOGOS[asset] ?? ASSET_LOGOS[stripVariantSuffix(asset)] ?? null;
}

export function AssetBadge({
  asset,
  size = 18,
  showLabel = true,
  labelMode = "full",
  amount,
  amountDigits = 4,
  compactAmount = false,
}: {
  asset: string | null;
  size?: number;
  showLabel?: boolean;
  labelMode?: "base" | "full";
  amount?: number | string | null;
  amountDigits?: number;
  compactAmount?: boolean;
}) {
  if (!asset) return <span style={{ opacity: 0.4 }}>—</span>;
  const Logo = getAssetLogo(asset);
  const label = labelMode === "base" ? stripVariantSuffix(asset) : asset;
  const variant = getVariant(asset);
  const background = variant ? VARIANT_ACCENTS[variant] ?? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.05)";
  const borderColor = variant ? VARIANT_BORDER[variant] ?? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.08)";
  const amountLabel = formatAmount(amount, amountDigits, compactAmount);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: showLabel ? "2px 6px" : 0,
        borderRadius: 999,
        background,
        border: showLabel ? `1px solid ${borderColor}` : "none",
        fontSize: 12,
      }}
    >
      {Logo ? <Logo size={size} /> : <span style={{ opacity: 0.4 }}>•</span>}
      {showLabel ? (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <span>{label}</span>
          {amountLabel ? <span style={{ fontSize: 11, opacity: 0.75 }}>{amountLabel}</span> : null}
        </span>
      ) : amountLabel ? (
        <span style={{ fontSize: 11, opacity: 0.75 }}>{amountLabel}</span>
      ) : null}
    </span>
  );
}

export function AssetPair({
  base,
  quote,
  size = 16,
  showLabels = true,
  separator = "/",
  mode = "split",
  showLogos = true,
}: {
  base: string | null;
  quote: string | null;
  size?: number;
  showLabels?: boolean;
  separator?: string;
  mode?: "split" | "combined";
  showLogos?: boolean;
}) {
  if (!base || !quote) {
    return <span style={{ opacity: 0.5 }}>—</span>;
  }

  if (mode === "combined") {
    const BaseLogo = getAssetLogo(base);
    const QuoteLogo = getAssetLogo(quote);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: showLabels ? 6 : 4,
          padding: showLabels ? "2px 12px" : "2px 8px",
          borderRadius: 999,
          background: "rgba(17, 24, 39, 0.45)",
          border: "1px solid rgba(148,163,184,0.28)",
          fontSize: 12,
        }}
      >
        {showLabels ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {showLogos ? (BaseLogo ? <BaseLogo size={size} /> : <span style={{ opacity: 0.5 }}>•</span>) : null}
              <span>{base}</span>
            </span>
            <span style={{ opacity: 0.6 }}>{separator}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {showLogos ? (QuoteLogo ? <QuoteLogo size={size} /> : <span style={{ opacity: 0.5 }}>•</span>) : null}
              <span>{quote}</span>
            </span>
          </span>
        ) : showLogos ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {BaseLogo ? <BaseLogo size={size} /> : <span style={{ opacity: 0.5 }}>•</span>}
            {QuoteLogo ? <QuoteLogo size={size} /> : <span style={{ opacity: 0.5 }}>•</span>}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <AssetBadge asset={base} size={size} showLabel={showLabels} />
      <span style={{ opacity: 0.4 }}>{separator}</span>
      <AssetBadge asset={quote} size={size} showLabel={showLabels} />
    </span>
  );
}

export function formatOperationLabel(step?: { op?: string | null; venue?: string | null }): string | null {
  if (!step || !step.op) return null;
  const op = step.op;
  const baseLabel =
    op === "swapEVM"
      ? "Swap"
      : op === "tradeCEX"
        ? "Trade"
        : op === "nativeMint"
          ? "Mint"
          : op === "nativeRedeem"
            ? "Redeem"
            : op.charAt(0).toUpperCase() + op.slice(1);
  const venueLabel = step.venue ? step.venue.toUpperCase() : null;
  if (!venueLabel) return baseLabel;
  return `${baseLabel} · ${venueLabel}`;
}

export function AssetPath({
  assets,
  size = 16,
  showLabels = false,
  labelMode = "full",
  steps,
}: {
  assets: Array<AssetId | string>;
  size?: number;
  showLabels?: boolean;
  labelMode?: "base" | "full";
  steps?: Array<{ op?: string | null; venue?: string | null }>;
}) {
  if (!assets || assets.length === 0) {
    return <span style={{ opacity: 0.5 }}>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {assets.map((asset, index) => {
        const operationLabel = steps && steps[index] ? formatOperationLabel(steps[index]) : null;
        return (
          <span key={`${asset}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <AssetBadge asset={asset} size={size} showLabel={showLabels} labelMode={labelMode} />
            {index < assets.length - 1 ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ opacity: 0.45 }}>→</span>
                {operationLabel ? (
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 999,
                      fontSize: 10,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "rgba(226,232,240,0.85)",
                    }}
                  >
                    {operationLabel}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
