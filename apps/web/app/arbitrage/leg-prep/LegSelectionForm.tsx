import type { ArbLegs } from "@domain/arbitrage/routing";
import type { ParsedParams, SegmentChoice } from "./legPrep.helpers";

export function LegSelectionForm({
  parsed,
  params,
  assetChoices,
  directionChoices,
  legChoices,
  selectedValue,
}: {
  parsed: ParsedParams;
  params: Record<string, string | string[] | undefined>;
  assetChoices: ArbLegs["asset"][];
  directionChoices: ArbLegs["direction"][];
  legChoices: SegmentChoice[];
  selectedValue: string;
}) {
  const pickFirst = (value: string | string[] | undefined): string | null => {
    if (!value) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
  };

  return (
    <form
      method="get"
      style={{
        display: "grid",
        gap: 12,
        padding: 16,
        borderRadius: 8,
        background: "#101621",
        border: "1px solid #1f2b3a",
      }}
    >
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="asset">Asset</label>
          <select
            id="asset"
            name="asset"
            defaultValue={parsed.asset}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          >
            {assetChoices.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="direction">Direction</label>
          <select
            id="direction"
            name="direction"
            defaultValue={parsed.direction}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          >
            {directionChoices.map((direction) => (
              <option key={direction} value={direction}>
                {direction.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="leg">
            Leg segment
            <span style={{ opacity: 0.6 }}> ({directionChoices.length > 0 ? parsed.direction.replace("_", " ") : ""})</span>
          </label>
          <select
            id="leg"
            name="leg"
            defaultValue={selectedValue}
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          >
            {legChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor="amount">
          Probe amount
          <span style={{ opacity: 0.6 }}> ({parsed.legChoice.need})</span>
        </label>
        <input
          id="amount"
          name="amount"
          type="text"
          defaultValue={pickFirst(params.amount) ?? ""}
          placeholder="Defaults to 1.0"
          style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="maxDepth">
            Max depth <span style={{ opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            id="maxDepth"
            name="maxDepth"
            type="number"
            min={1}
            defaultValue={parsed.maxDepth ?? ""}
            placeholder="Auto"
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          />
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor="pathLimit">
            Path limit <span style={{ opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            id="pathLimit"
            name="pathLimit"
            type="number"
            min={1}
            defaultValue={parsed.pathLimit ?? ""}
            placeholder="All"
            style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            background: "#16c784",
            color: "#04121d",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Evaluate Leg
        </button>
        <a
          href="/arbitrage/leg-prep"
          style={{
            padding: "8px 16px",
            color: "#d1e4ff",
            borderRadius: 6,
            border: "1px solid #1f2b3a",
            textDecoration: "none",
          }}
        >
          Reset
        </a>
      </div>
    </form>
  );
}
