import type { ReactNode } from "react";

import type { InfoEntry } from "./clipExplorer.types";

export function InfoTile({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "amber" }) {
  const palette =
    tone === "blue"
      ? { background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)" }
      : tone === "green"
        ? { background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)" }
        : { background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)" };
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        background: palette.background,
        border: palette.border,
        display: "grid",
        gap: 2,
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{value}</span>
    </div>
  );
}

export function InfoGrid({ entries }: { entries: InfoEntry[] }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
      {entries.map((entry, index) => {
        const align = entry.align ?? "end";
        const color = entry.tone === "positive" ? "#16c784" : entry.tone === "negative" ? "#f45b69" : "#dce5f5";
        let valueNode: ReactNode = entry.value;
        if (valueNode === null || valueNode === undefined || valueNode === "") {
          valueNode = "—";
        }
        return (
          <div
            key={`${entry.label}-${index}`}
            style={{
              display: "grid",
              gap: 4,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(15,23,42,0.62)",
              border: "1px solid rgba(148,163,184,0.12)",
              minHeight: 78,
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.72, textTransform: "uppercase", letterSpacing: 0.45 }}>
              {entry.label}
            </span>
            <div
              style={{
                display: "flex",
                justifyContent: align === "start" ? "flex-start" : "flex-end",
                textAlign: align === "start" ? "left" : "right",
                color,
                fontSize: 12,
                fontWeight: 600,
                gap: 4,
                alignItems: "center",
              }}
            >
              {valueNode}
            </div>
            {entry.hint ? (
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.65,
                  display: "grid",
                  gap: 2,
                  color: "#b4c2d9",
                }}
              >
                {entry.hint}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
