import type { AssetId } from "@domain/types";
import type { PathAssetDelta, PathEvaluation, PathInventoryShortfall } from "@domain/pathing";
import { getAssetDecimals } from "@/app/shared/assetMetadata";
import { formatAmount, formatUnits } from "../quoters/quoteHelpers";
import { getAssetLogo } from "@/components/AssetBadge";

const CARD_GAP = 12;
const CARD_BASIS = `calc((100% - ${CARD_GAP * 5}px) / 6)`;
const MAX_DECIMALS = 4;

function limitDecimals(value: string, digits: number): string {
  if (digits < 0) return value;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  if (!fraction) return value;
  if (fraction.length <= digits) return value;
  const limited = fraction.slice(0, digits).replace(/0+$/, "");
  const body = limited.length > 0 ? `${whole}.${limited}` : whole;
  return negative ? `-${body}` : body;
}

function getDecimalAmount(amount: bigint | null | undefined, asset: AssetId): number | null {
  if (amount == null) return null;
  const decimals = getAssetDecimals(asset);
  const units = formatUnits(amount, decimals);
  const numeric = Number.parseFloat(units);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatAmountLabel(amount: bigint | null | undefined, asset: AssetId): string {
  if (amount == null) return `— ${asset}`;
  const decimals = getAssetDecimals(asset);
  const formatted = formatAmount(amount, decimals);
  const raw = formatted.decimal ?? formatted.wei;
  const display = raw ? limitDecimals(raw, MAX_DECIMALS) : raw;
  return `${display} ${asset}`;
}

function NodeCard({
  asset,
  amountLabel,
  usdLabel,
  highlight,
  inventoryLabel,
  inventoryTone,
}: {
  asset: AssetId;
  amountLabel: string;
  usdLabel: string;
  highlight?: "start" | "end";
  inventoryLabel?: string | null;
  inventoryTone?: "ok" | "warn" | "error" | "info";
}) {
  const palette =
    highlight === "start"
      ? { border: "#16c784", background: "rgba(22,199,132,0.12)", accent: "#16c784" }
      : highlight === "end"
        ? { border: "#5271ff", background: "rgba(82,113,255,0.12)", accent: "#5271ff" }
        : { border: "rgba(31,43,58,0.9)", background: "rgba(11,15,20,0.65)", accent: "rgba(151,160,175,0.8)" };
  const Logo = getAssetLogo(asset);

  return (
    <div
      style={{
        minWidth: 120,
        flex: `0 0 ${CARD_BASIS}`,
        maxWidth: CARD_BASIS,
        borderRadius: 12,
        padding: "10px 12px",
        border: `1px solid ${palette.border}`,
        background: palette.background,
        display: "grid",
        gap: 4,
        alignSelf: "stretch",
        marginTop: 16,
        position: "relative",
        wordBreak: "break-word",
      }}
    >
      {Logo ? (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 26,
            height: 26,
            opacity: highlight ? 0.95 : 0.8,
          }}
        >
          <Logo size={26} />
        </div>
      ) : null}
      {highlight ? (
        <span
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            opacity: 0.75,
            color: palette.accent,
          }}
        >
          {highlight === "start" ? "From" : "To"}
        </span>
      ) : null}
      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{amountLabel}</span>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{usdLabel}</span>
      {inventoryLabel ? (
        <span
          style={{
            fontSize: 11,
            opacity: 0.85,
            color: inventoryTone ? inventoryTonePalette[inventoryTone].color : "#c6d7ff",
          }}
        >
          {inventoryLabel}
        </span>
      ) : null}
      <span style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.6 }}>{asset}</span>
    </div>
  );
}

function HopCard({
  hop,
  formatUsd,
  formatBps,
}: {
  hop: PathEvaluation["hops"][number];
  formatUsd: (value: number | null | undefined) => string;
  formatBps: (value: number | null | undefined) => string;
}) {
  const allowed = hop.allowed;
  const palette = allowed
    ? { border: "rgba(31,43,58,0.8)", background: "rgba(11,15,20,0.6)" }
    : { border: "rgba(244,91,105,0.6)", background: "rgba(244,91,105,0.12)" };
  const allowanceTitle =
    hop.allowanceReasons.length > 0
      ? hop.allowanceReasons.join(", ")
      : allowed
        ? "Allowed"
        : "Blocked";
  const warningTitle = hop.warnings && hop.warnings.length > 0 ? hop.warnings.join(", ") : undefined;
  const operationTone = allowed ? "rgba(82,113,255,0.85)" : "rgba(244,91,105,0.85)";
  const opLabel = hop.op.toUpperCase();
  const isLongOp = opLabel.length > 10;

  return (
    <div
      style={{
        minWidth: 120,
        flex: `0 0 ${CARD_BASIS}`,
        maxWidth: CARD_BASIS,
        borderRadius: 12,
        padding: "10px 12px",
        border: `1px dashed ${palette.border}`,
        background: palette.background,
        display: "grid",
        gap: 4,
        alignSelf: "stretch",
        justifyItems: "stretch",
        marginTop: 24,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -14,
          left: 16,
          right: 16,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <span
          title={hop.op}
          style={{
            background: operationTone,
            color: "#05090f",
            borderRadius: 999,
            padding: "4px 16px",
            fontSize: isLongOp ? 10 : 11,
            fontWeight: 600,
            letterSpacing: isLongOp ? 0.4 : 0.7,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 10px rgba(4, 10, 18, 0.35)",
            border: `1px solid ${allowed ? "rgba(82,113,255,0.4)" : "rgba(244,91,105,0.4)"}`,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas",
          }}
        >
          {`--- ${opLabel} --->`}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
        }}
      >
        <span
          title={allowanceTitle}
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: allowed ? "#16c784" : "#f45b69",
          }}
        >
          {allowed ? "✓" : "!"}
        </span>
        {warningTitle ? (
          <span title={warningTitle} style={{ fontSize: 12, color: "#e5b567" }}>
            ⚠️
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, display: "grid", gap: 2 }}>
        <span>Fee: {formatUsd(hop.feeUsd)}</span>
        <span>Gas: {formatUsd(hop.gasUsd)}</span>
        <span>Bps: {formatBps(hop.feeBps)}</span>
      </div>
    </div>
  );
}

export type PathTimelineProps = {
  evaluation: PathEvaluation;
  startAmount: bigint | null;
  priceMap: Partial<Record<AssetId, number>>;
  formatUsd: (value: number | null | undefined) => string;
  formatBps: (value: number | null | undefined) => string;
};

export function PathTimeline({
  evaluation,
  startAmount,
  priceMap,
  formatUsd,
  formatBps,
}: PathTimelineProps): JSX.Element {
  const nodes: Array<{ asset: AssetId; amount: bigint | null }> = [];
  const deltaMap = new Map<AssetId, PathAssetDelta>();
  evaluation.assetDeltas.forEach((delta) => {
    if (!deltaMap.has(delta.asset)) {
      deltaMap.set(delta.asset, delta);
    }
  });
  const initialAmount =
    evaluation.hops[0]?.amountIn ??
    evaluation.hops[0]?.amountOut ??
    startAmount ??
    evaluation.finalAmountOut ??
    null;
  nodes.push({ asset: evaluation.path.assets[0], amount: initialAmount });
  evaluation.hops.forEach((hop) => {
    const amount = hop.amountOut ?? hop.amountIn ?? null;
    nodes.push({ asset: hop.to, amount });
  });

  const elements: JSX.Element[] = [];
  nodes.forEach((node, index) => {
    const amountLabel = formatAmountLabel(node.amount, node.asset);
    const decimalAmount = getDecimalAmount(node.amount, node.asset);
    const price = priceMap[node.asset];
    const usdValue = price != null && decimalAmount != null ? decimalAmount * price : null;
    const usdLabel = `≈ ${formatUsd(usdValue)}`;
    const highlight = index === 0 ? "start" : index === nodes.length - 1 ? "end" : undefined;
    const inventory = summarizeInventory(
      node.asset,
      deltaMap.get(node.asset),
      evaluation.inventory.shortfalls,
      decimalAmount,
    );

    elements.push(
      <NodeCard
        key={`node-${index}-${node.asset}`}
        asset={node.asset}
        amountLabel={amountLabel}
        usdLabel={usdLabel}
        highlight={highlight}
        inventoryLabel={inventory.label}
        inventoryTone={inventory.tone}
      />,
    );

    if (index < evaluation.hops.length) {
      elements.push(
        <HopCard
          key={`hop-${index}`}
          hop={evaluation.hops[index]}
          formatUsd={formatUsd}
          formatBps={formatBps}
        />,
      );
    }
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: CARD_GAP,
        alignItems: "stretch",
        paddingBottom: 4,
      }}
    >
      {elements}
    </div>
  );
}

export function buildPriceMap(evaluation: PathEvaluation): Partial<Record<AssetId, number>> {
  const map: Partial<Record<AssetId, number>> = {};
  for (const delta of evaluation.assetDeltas) {
    const amount = Math.abs(delta.amountDecimal);
    if (amount > 0 && delta.usdChange != null) {
      const price = Math.abs(delta.usdChange) / amount;
      if (Number.isFinite(price) && price > 0) {
        map[delta.asset] = price;
      }
    }
  }
  return map;
}

type InventoryTone = "ok" | "warn" | "error" | "info";

const inventoryTonePalette: Record<InventoryTone, { color: string }> = {
  ok: { color: "#16c784" },
  warn: { color: "#ffc107" },
  error: { color: "#f45b69" },
  info: { color: "#c6d7ff" },
};

function summarizeInventory(
  asset: AssetId,
  delta: PathAssetDelta | undefined,
  shortfalls: PathInventoryShortfall[] | undefined,
  requiredAmount: number | null,
): { label: string | null; tone: InventoryTone } {
  const shortfall = shortfalls?.find((entry) => entry.asset === asset);
  if (shortfall) {
    const needText = requiredAmount != null ? formatInventoryNumber(requiredAmount) : "—";
    const inventoryText = formatInventoryNumber(shortfall.startingBalance ?? delta?.startingBalance ?? null);
    const shortfallText = formatInventoryNumber(shortfall.shortfall ?? null);
    const label = `Need ${needText} · Inventory ${inventoryText} · Shortfall ${shortfallText}`;
    return { label, tone: "error" };
  }

  if (!delta) return { label: null, tone: "info" };
  if (delta.startingBalance == null || delta.endingBalance == null) {
    return { label: "Inventory: —", tone: "warn" };
  }
  const start = formatInventoryNumber(delta.startingBalance);
  const end = formatInventoryNumber(delta.endingBalance);
  const label = `Inventory: ${start} → ${end}`;
  if (delta.endingBalance < -1e-9) {
    return { label: `${label} (short)`, tone: "error" };
  }
  return { label, tone: "ok" };
}

function formatInventoryNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}
