import { buildGlobalState } from "@domain/state/state.builder";
import { colors, styles } from "@/components/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderJsonBlock(label: string, data: unknown) {
  if (data == null) {
    return (
      <section
        key={label}
        style={{
          display: "grid",
          gap: 8,
          ...styles.card,
        }}
      >
        <header style={{ fontWeight: 600 }}>{label}</header>
        <div style={{ opacity: 0.7 }}>No data available.</div>
      </section>
    );
  }

  const json = JSON.stringify(
    data,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );

  return (
    <section
      key={label}
      style={{
        display: "grid",
        gap: 8,
        ...styles.card,
      }}
    >
      <header style={{ fontWeight: 600 }}>{label}</header>
      <pre
        style={{
          margin: 0,
          padding: 12,
          borderRadius: 6,
          background: colors.bg.input,
          overflowX: "auto",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {json}
      </pre>
    </section>
  );
}

export default async function GlobalStatePage() {
  const state = await buildGlobalState();

  const sections = [
    renderJsonBlock("Zephyr", state.zephyr),
    renderJsonBlock("Bridge", state.bridge ?? null),
    renderJsonBlock("EVM", state.evm ?? null),
    renderJsonBlock("CEX", state.cex ?? null),
  ];

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Global State Snapshot</h1>
        <p style={{ margin: 0, opacity: 0.75, lineHeight: 1.55 }}>
          This view materializes the current venue snapshots used by routing, quoting, and runtime layers. Values
          are refreshed on request so you can confirm watcher health, pool metadata, and bridge/CEX parameters in one place.
        </p>
      </header>
      <div style={{ display: "grid", gap: 18 }}>{sections}</div>
    </div>
  );
}
