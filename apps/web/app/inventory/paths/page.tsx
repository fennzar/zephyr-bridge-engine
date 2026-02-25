import type { AssetId } from "@domain/types";
import { ASSET_STEPS, findAssetPaths, type AssetPath } from "@domain/inventory/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSET_IDS = Object.keys(ASSET_STEPS) as AssetId[];
const SORTED_ASSET_IDS = [...ASSET_IDS].sort((a, b) => a.localeCompare(b));
const ASSET_SET = new Set<AssetId>(ASSET_IDS);

type SearchParams = Record<string, string | string[] | undefined>;

function pickFirst(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toAssetId(value: string | null): AssetId | null {
  if (!value) return null;
  return ASSET_SET.has(value as AssetId) ? (value as AssetId) : null;
}

function parseMaxDepth(raw: string | null): { value: number | undefined; error?: string } {
  if (!raw) return { value: undefined };
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: undefined, error: "Max depth must be a positive integer." };
  }
  return { value: parsed };
}

function formatPath(path: AssetPath): string {
  return path.assets.join(" -> ");
}

export default async function InventoryPathsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const resolved = await searchParams;
  const fromParam = pickFirst(resolved?.from);
  const toParam = pickFirst(resolved?.to);
  const depthParam = pickFirst(resolved?.maxDepth);

  const errors: string[] = [];

  const fromAsset = toAssetId(fromParam);
  if (fromParam && !fromAsset) {
    errors.push(`Unknown asset for 'from': ${fromParam}`);
  }

  const toAsset = toAssetId(toParam);
  if (toParam && !toAsset) {
    errors.push(`Unknown asset for 'to': ${toParam}`);
  }

  const { value: maxDepth, error: depthError } = parseMaxDepth(depthParam);
  if (depthError) errors.push(depthError);

  const showResults = Boolean(fromAsset && toAsset && errors.length === 0);
  const paths =
    showResults && fromAsset && toAsset
      ? findAssetPaths(fromAsset, toAsset, maxDepth)
      : [];

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Inventory Path Explorer</h1>
        <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.6 }}>
          Select source and destination assets to enumerate the simple paths between them. Paths are
          derived from the static inventory graph and do not consider runtime availability yet.
        </p>
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
          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="from">From asset</label>
            <select
              id="from"
              name="from"
              defaultValue={fromAsset ?? ""}
              style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
              required
            >
              <option value="" disabled>
                Select asset
              </option>
              {SORTED_ASSET_IDS.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="to">To asset</label>
            <select
              id="to"
              name="to"
              defaultValue={toAsset ?? ""}
              style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
              required
            >
              <option value="" disabled>
                Select asset
              </option>
              {SORTED_ASSET_IDS.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="maxDepth">
              Max depth <span style={{ opacity: 0.6 }}>(optional)</span>
            </label>
            <input
              id="maxDepth"
              name="maxDepth"
              type="number"
              min={1}
              defaultValue={maxDepth ?? ""}
              placeholder="Auto"
              style={{ padding: "8px 10px", background: "#0b0f14", color: "#d1e4ff" }}
            />
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
              Find Paths
            </button>
            <a
              href="/inventory/paths"
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

        {errors.length > 0 && (
          <div
            style={{
              background: "#261219",
              border: "1px solid #6f1f2e",
              borderRadius: 8,
              padding: 12,
              color: "#f45b69",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Input issues</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {showResults && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Results</span>
              <span style={{ opacity: 0.7 }}>
                {paths.length === 0
                  ? "No paths found."
                  : `${paths.length} path${paths.length === 1 ? "" : "s"} discovered.`}
              </span>
            </div>

            {paths.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {paths.map((path, index) => (
                  <div
                    key={`${path.assets.join("->")}-${index}`}
                    style={{
                      border: "1px solid #1f2b3a",
                      borderRadius: 8,
                      padding: 16,
                      background: "#101621",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 600 }}>
                        Path {index + 1}: {formatPath(path)}
                      </div>
                      <div style={{ opacity: 0.7, fontSize: 13 }}>
                        {path.steps.length} hop{path.steps.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
                      {path.steps.map((step, stepIndex) => (
                        <li key={`${step.from}-${step.to}-${stepIndex}`}>
                          <span style={{ fontWeight: 500 }}>{step.from}</span>
                          <span style={{ opacity: 0.7 }}> --[{step.op} @ {step.venue}] {"->"} </span>
                          <span style={{ fontWeight: 500 }}>{step.to}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  background: "#101621",
                  border: "1px solid #1f2b3a",
                  opacity: 0.85,
                }}
              >
                No valid routes were found for this pair. Try increasing the allow depth or
                selecting a different destination.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
