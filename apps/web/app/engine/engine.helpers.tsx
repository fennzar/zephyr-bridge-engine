"use client";

import { colors, styles, statusColor } from "@/components/theme";

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: on ? colors.accent.green : "rgba(255,255,255,0.2)",
      }}
    />
  );
}

export function Badge({
  label,
  status,
}: {
  label: string;
  status: string;
}) {
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
      {label}
    </span>
  );
}

export function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={{ ...styles.card, display: "grid", gap: 6 }}>
      <div style={styles.label}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
