import { styles, statusColor } from "@/components/theme";
import { formatTokenAmount, formatCurrency } from "@/components/format";

export type EngineLPPosition = {
  id: string;
  poolId: string;
  chainId: number;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  token0Amount: string | null;
  token1Amount: string | null;
  fees0Unclaimed: string | null;
  fees1Unclaimed: string | null;
  status: string;
  targetMode: string | null;
  lastRebalanceAt: string | null;
  createdAt: string;
  updatedAt: string;
  pool: {
    id: string;
    address: string;
    token0: { symbol: string; decimals: number } | null;
    token1: { symbol: string; decimals: number } | null;
    feeTierBps: number | null;
    tickSpacing: number | null;
  } | null;
};

type StatsCardProps = {
  label: string;
  value: string;
  helper?: string;
};

export function StatsCard({ label, value, helper }: StatsCardProps) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        ...styles.card,
        padding: "14px 16px",
      }}
    >
      <span style={styles.label}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600 }}>{value}</span>
      {helper ? (
        <span style={{ fontSize: 12, opacity: 0.6 }}>{helper}</span>
      ) : null}
    </div>
  );
}

type TokenBalanceCellProps = {
  amount?: number | null;
  usd?: number | null;
  symbol: string;
};

export function TokenBalanceCell({ amount, usd, symbol }: TokenBalanceCellProps) {
  const hasAmount = amount != null && !Number.isNaN(amount);
  const hasUsd = usd != null && !Number.isNaN(usd);

  return (
    <div
      style={{
        display: "grid",
        gap: 2,
        justifyItems: "end",
      }}
    >
      <div style={{ fontWeight: 500 }}>
        {hasAmount ? `${formatTokenAmount(amount)} ${symbol}` : "\u2014"}
      </div>
      <div style={{ fontSize: 12, opacity: 0.6 }}>
        {hasUsd ? formatCurrency(usd) : "\u2014"}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const sc = statusColor(status);
  return (
    <span
      style={{
        ...styles.badge,
        color: sc.color,
        background: sc.bg,
        border: sc.border,
      }}
    >
      {status}
    </span>
  );
}
