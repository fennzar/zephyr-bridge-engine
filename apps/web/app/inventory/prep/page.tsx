import type { AssetId } from "@domain/types";
import {
  ARB_DEFS,
  buildLegPreparationPlan,
  type ArbLegs,
  type ArbDirection,
} from "@domain/arbitrage/routing";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function parseMaxDepth(raw: string | null): { value: number | undefined; error?: string } {
  if (!raw) return { value: undefined };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: undefined, error: "Max depth must be a positive integer." };
  }
  return { value: parsed };
}

function formatAssetPath(assets: AssetId[]): string {
  return assets.join(" -> ");
}

function findLeg(asset: string | null, direction: string | null): ArbLegs | null {
  if (!asset || !direction) return null;
  return (
    ARB_DEFS.find(
      (candidate) => candidate.asset === asset && candidate.direction === direction,
    ) ?? null
  );
}

function renderPlan(plan: ReturnType<typeof buildLegPreparationPlan>) {
  const variantTitle = `${plan.asset} / ${plan.direction}`;
  return (
    <div
      key={`${plan.asset}-${plan.direction}`}
      style={{ display: "grid", gap: 12, padding: 16, borderRadius: 8, background: "#101621", border: "1px solid #1f2b3a" }}
    >
      <div style={{ fontSize: 18, fontWeight: 600 }}>{variantTitle}</div>
      <section style={{ display: "grid", gap: 8 }}>
        <header style={{ fontWeight: 600 }}>Open Leg Requirements</header>
        {plan.open.map((prep) => (
          <div
            key={`${prep.step.from}-${prep.step.to}-${prep.step.op.join("-")}`}
            style={{ display: "grid", gap: 6, padding: 12, borderRadius: 6, border: "1px solid #1f2b3a", background: "#0b111c" }}
          >
            <div>
              Need <strong>{prep.need}</strong> to execute{" "}
              <span style={{ opacity: 0.7 }}>{prep.step.op.join(", ")}</span>
              {" -> "}
              <strong>{prep.step.to}</strong>
            </div>
            {prep.candidates.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No funding paths available.</div>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                {prep.candidates.map(({ source, path }, idx) => (
                  <li key={`${source}-${idx}`}>
                    <span style={{ fontWeight: 500 }}>{source}</span>
                    <span style={{ opacity: 0.7 }}> via </span>
                    <span>{formatAssetPath(path.assets)}</span>
                    <span style={{ opacity: 0.6 }}> ({path.steps.length} hops)</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </section>
      <section style={{ display: "grid", gap: 8 }}>
        <header style={{ fontWeight: 600 }}>Close Leg Requirements</header>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 500 }}>Native Option</div>
            {plan.close.native.map((prep) => (
              <div
                key={`native-${prep.step.from}-${prep.step.to}-${prep.step.op.join("-")}`}
                style={{ display: "grid", gap: 6, padding: 12, borderRadius: 6, border: "1px solid #1f2b3a", background: "#0b111c" }}
              >
                <div>
                  Need <strong>{prep.need}</strong> to execute{" "}
                  <span style={{ opacity: 0.7 }}>{prep.step.op.join(", ")}</span>
                  {" -> "}
                  <strong>{prep.step.to}</strong>
                </div>
                {prep.candidates.length === 0 ? (
                  <div style={{ opacity: 0.7 }}>No funding paths available.</div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                    {prep.candidates.map(({ source, path }, idx) => (
                      <li key={`native-${source}-${idx}`}>
                        <span style={{ fontWeight: 500 }}>{source}</span>
                        <span style={{ opacity: 0.7 }}> via </span>
                        <span>{formatAssetPath(path.assets)}</span>
                        <span style={{ opacity: 0.6 }}> ({path.steps.length} hops)</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
          {plan.close.cex && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 500 }}>CEX Option</div>
              {plan.close.cex.map((prep) => (
                <div
                  key={`cex-${prep.step.from}-${prep.step.to}-${prep.step.op.join("-")}`}
                  style={{ display: "grid", gap: 6, padding: 12, borderRadius: 6, border: "1px solid #1f2b3a", background: "#0b111c" }}
                >
                  <div>
                    Need <strong>{prep.need}</strong> to execute{" "}
                    <span style={{ opacity: 0.7 }}>{prep.step.op.join(", ")}</span>
                    {" -> "}
                    <strong>{prep.step.to}</strong>
                  </div>
                  {prep.candidates.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No funding paths available.</div>
                  ) : (
                    <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                      {prep.candidates.map(({ source, path }, idx) => (
                        <li key={`cex-${source}-${idx}`}>
                          <span style={{ fontWeight: 500 }}>{source}</span>
                          <span style={{ opacity: 0.7 }}> via </span>
                          <span>{formatAssetPath(path.assets)}</span>
                          <span style={{ opacity: 0.6 }}> ({path.steps.length} hops)</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default async function InventoryPreparationPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolved = await searchParams;
  const depthParam = pickFirst(resolved?.maxDepth);
  const assetParam = pickFirst(resolved?.asset);
  const directionParam = pickFirst(resolved?.direction);
  const { value: maxDepth, error } = parseMaxDepth(depthParam);

  const leg = findLeg(assetParam, directionParam);
  const plan = leg ? buildLegPreparationPlan(leg, { maxDepth }) : null;
  const assetOptions = Array.from(new Set(ARB_DEFS.map((legDef) => legDef.asset))).sort();
  const directionOptions: ArbDirection[] = ["evm_discount", "evm_premium"];

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Arb Leg Preparation Planner</h1>
        <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.6 }}>
          Explore how to stage inventory for each arbitrage leg. Funding paths are derived from the static asset graph and list the shortest routes first.
        </p>
        <form
          method="get"
          style={{
            display: "grid",
            gap: 12,
            background: "#101621",
            border: "1px solid #1f2b3a",
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <label htmlFor="asset" style={{ display: "grid", gap: 4 }}>
              <span>Asset</span>
              <select
                id="asset"
                name="asset"
                defaultValue={assetParam ?? ""}
                required
                style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
              >
                <option value="" disabled>
                  Select asset
                </option>
                {assetOptions.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="direction" style={{ display: "grid", gap: 4 }}>
              <span>Direction</span>
              <select
                id="direction"
                name="direction"
                defaultValue={directionParam ?? ""}
                required
                style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
              >
                <option value="" disabled>
                  Select direction
                </option>
                {directionOptions.map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="maxDepth" style={{ display: "grid", gap: 4 }}>
              <span>Max path depth</span>
              <input
                id="maxDepth"
                name="maxDepth"
                type="number"
                min={1}
                placeholder="Auto"
                defaultValue={maxDepth ?? ""}
                style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
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
                Apply
              </button>
              <a
                href="/inventory/prep"
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
          </div>
          <div
            style={{
              display: "grid",
              gap: 4,
              fontSize: 12,
              opacity: 0.7,
            }}
          >
            <span>Asset + Direction required; depth optional.</span>
          </div>
        </form>
        {error && (
          <div
            style={{
              background: "#261219",
              border: "1px solid #6f1f2e",
              borderRadius: 8,
              padding: 12,
              color: "#f45b69",
            }}
          >
            {error}
          </div>
        )}
      </div>
      {!leg ? (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid #1f2b3a",
            background: "#101621",
            opacity: 0.8,
          }}
        >
          Select an asset and direction to view preparation steps.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>{plan ? renderPlan(plan) : null}</div>
      )}
    </div>
  );
}
