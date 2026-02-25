import type { ReactNode } from "react";
import type { FlowTone } from "./clipExplorer.types";

export function FlowCard({
  title,
  tone,
  children,
  labels,
}: {
  title: string;
  tone: FlowTone;
  children: ReactNode;
  labels?: string[];
}) {
  const palette =
    tone === "open"
      ? { border: "rgba(82,113,255,0.35)", background: "rgba(37,65,140,0.35)" }
      : tone === "bridge"
        ? { border: "rgba(148,163,184,0.3)", background: "rgba(30,41,59,0.4)" }
        : tone === "close-native"
          ? { border: "rgba(34,197,94,0.45)", background: "rgba(22,199,132,0.22)" }
          : { border: "rgba(139,92,246,0.45)", background: "rgba(99,102,241,0.24)" };

  return (
    <div
      style={{
        flex: "1 1 260px",
        minWidth: 220,
        borderRadius: 12,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        padding: "12px 14px",
        display: "grid",
        gap: 8,
        alignSelf: "stretch",
      }}
    >
      <span style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.45 }}>{title}</span>
      <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{children}</div>
      {labels && labels.length > 0 ? <OperationChipRow labels={labels} /> : null}
    </div>
  );
}

export function FlowArrow() {
  return (
    <div
      style={{
        alignSelf: "center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 6px",
      }}
    >
      <span
        style={{
          fontSize: 18,
          opacity: 0.45,
        }}
      >
        →
      </span>
    </div>
  );
}

export function OperationChipRow({ labels }: { labels: string[] }) {
  if (!labels || labels.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          style={{
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.45,
            background: "rgba(99,102,241,0.14)",
            border: "1px solid rgba(99,102,241,0.28)",
            color: "#c7d2fe",
          }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
