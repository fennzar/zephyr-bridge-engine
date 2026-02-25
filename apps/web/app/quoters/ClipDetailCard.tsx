import type { CSSProperties, ReactNode } from "react";

export function ClipDetailCard({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 16,
        display: "grid",
        gap: 12,
        background: "rgba(8,12,20,0.55)",
        ...(style ?? {}),
      }}
    >
      <header style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7 }}>{title}</header>
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </section>
  );
}
