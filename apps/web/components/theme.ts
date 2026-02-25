import type { CSSProperties } from "react";

export const colors = {
  bg: {
    body: "#0b0f14",
    section: "#0e141b",
    card: "#101720",
    input: "#0b111a",
  },
  border: {
    primary: "#1b2330",
    subtle: "rgba(255,255,255,0.06)",
    input: "rgba(255,255,255,0.18)",
  },
  text: {
    primary: "#d1e4ff",
    muted: "rgba(209,228,255,0.7)",
    dimmed: "rgba(209,228,255,0.5)",
  },
  accent: {
    green: "#16c784",
    red: "#f45b69",
    orange: "#f7ad4c",
    blue: "#61a0ff",
    greenBg: "rgba(22,199,132,0.12)",
    redBg: "rgba(244,91,105,0.12)",
    orangeBg: "rgba(247,173,76,0.12)",
    blueBg: "rgba(97,160,255,0.12)",
  },
} as const;

export const styles = {
  section: {
    border: `1px solid ${colors.border.primary}`,
    borderRadius: 10,
    padding: 16,
    background: colors.bg.section,
  } satisfies CSSProperties,

  card: {
    border: `1px solid ${colors.border.primary}`,
    borderRadius: 8,
    padding: 12,
    background: colors.bg.card,
  } satisfies CSSProperties,

  badge: {
    fontSize: 11,
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${colors.border.primary}`,
  } satisfies CSSProperties,

  button: {
    padding: "6px 14px",
    borderRadius: 6,
    border: `1px solid ${colors.border.input}`,
    background: colors.bg.card,
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  } satisfies CSSProperties,

  buttonPrimary: {
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid rgba(97,160,255,0.3)",
    background: "rgba(97,160,255,0.15)",
    color: colors.accent.blue,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  } satisfies CSSProperties,

  input: {
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${colors.border.input}`,
    background: colors.bg.input,
    color: "#fff",
    fontSize: 12,
  } satisfies CSSProperties,

  label: {
    fontSize: 11,
    opacity: 0.55,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  } satisfies CSSProperties,

  tableHeader: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 11,
    opacity: 0.55,
  } satisfies CSSProperties,

  pageContainer: {
    maxWidth: 1000,
    margin: "40px auto",
    padding: 24,
  } satisfies CSSProperties,

  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 13,
  } satisfies CSSProperties,
} as const;

export function statusColor(
  status: string,
): { color: string; bg: string; border: string } {
  switch (status) {
    case "completed":
    case "success":
    case "active":
    case "normal":
      return {
        color: colors.accent.green,
        bg: colors.accent.greenBg,
        border: `1px solid rgba(22,199,132,0.3)`,
      };
    case "failed":
    case "error":
    case "crisis":
      return {
        color: colors.accent.red,
        bg: colors.accent.redBg,
        border: `1px solid rgba(244,91,105,0.3)`,
      };
    case "executing":
    case "pending":
    case "defensive":
      return {
        color: colors.accent.orange,
        bg: colors.accent.orangeBg,
        border: `1px solid rgba(247,173,76,0.3)`,
      };
    default:
      return {
        color: colors.text.dimmed,
        bg: "rgba(255,255,255,0.05)",
        border: `1px solid ${colors.border.primary}`,
      };
  }
}
