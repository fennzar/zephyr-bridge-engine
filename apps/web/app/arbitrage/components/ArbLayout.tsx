import type { ReactNode } from "react";

export function ArbSection({
  title,
  subtitle,
  children,
  id,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: 18,
        background: "#0e141b",
        display: "grid",
        gap: 12,
      }}
    >
      {(title || subtitle) && (
        <header style={{ display: "grid", gap: 4 }}>
          {title ? (
            <div style={{ fontSize: 12, opacity: 0.65, textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</div>
          ) : null}
          {subtitle ? <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function ArbBadge({
  text,
  color,
  subtle = false,
  mono = false,
  title,
}: {
  text: string;
  color: string;
  subtle?: boolean;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color: subtle ? color : "#0b1118",
        background: subtle ? "transparent" : color,
        textTransform: mono ? "none" : "uppercase",
        letterSpacing: mono ? 0 : 0.6,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export function ArbStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 12,
        background: "#101720",
        display: "grid",
        gap: 4,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.65 }}>{hint}</div> : null}
    </div>
  );
}
