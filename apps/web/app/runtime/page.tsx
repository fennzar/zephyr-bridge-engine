import type { AssetId, OpType } from "@domain/types";
import { buildGlobalState } from "@domain/state/state.builder";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import type { SwapEvmContext } from "@domain/runtime/runtime.evm";
import type { NativeOperationContext } from "@domain/runtime/runtime.zephyr";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import { RuntimeControls } from "./RuntimeControls";
import { operationsToAsset, type OperationSelection } from "../shared/operations";
import {
  RUNTIME_ASSETS,
  RUNTIME_OPERATION_CHOICES,
  RUNTIME_OPERATIONS,
  RUNTIME_OPERATIONS_MATRIX,
} from "./config";
import { colors, styles } from "@/components/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS = RUNTIME_ASSETS;
const OPERATIONS = RUNTIME_OPERATIONS;
const OPERATION_CHOICES = RUNTIME_OPERATION_CHOICES;
const OPERATIONS_MATRIX = RUNTIME_OPERATIONS_MATRIX;

type SearchParams = Record<string, string | string[] | undefined>;

const SERIALIZE = (_: string, value: unknown) => {
  if (typeof value === "bigint") return value.toString();
  return value;
};

function normalizeParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isAssetId(value: string | null): value is AssetId {
  return value != null && (ASSETS as string[]).includes(value);
}

function isOpType(value: string | null): value is OpType {
  return value != null && (OPERATIONS as string[]).includes(value);
}

export default async function OperationRuntimePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const opParam = normalizeParam(params.op);
  const fromParam = normalizeParam(params.from);
  const toParam = normalizeParam(params.to);

  const selectedOperation: OperationSelection = opParam === "auto" ? "auto" : isOpType(opParam) ? opParam : "auto";
  const selectedFrom: AssetId | null = isAssetId(fromParam) ? fromParam : null;
  const toCandidate: AssetId | null = isAssetId(toParam) ? toParam : null;
  const selectedTo: AssetId | null = (() => {
    if (!selectedFrom || !toCandidate) return null;
    const opsToCandidate = operationsToAsset(OPERATIONS_MATRIX, selectedFrom, toCandidate);
    if (opsToCandidate.length === 0) return null;
    if (selectedOperation === "auto") return toCandidate;
    return opsToCandidate.includes(selectedOperation) ? toCandidate : null;
  })();

  const impliedOps = selectedFrom && selectedTo ? operationsToAsset(OPERATIONS_MATRIX, selectedFrom, selectedTo) : [];
  const effectiveOp: OpType | null = selectedOperation === "auto" ? impliedOps[0] ?? null : selectedOperation;

  const state = await buildGlobalState();

  type RuntimeContext = SwapEvmContext | NativeOperationContext | BridgeOperationContext | CexOperationContext;
  const runtimeEntry = effectiveOp ? (OP_RUNTIME[effectiveOp] as OperationRuntime<RuntimeContext> | undefined) : undefined;

  let enabled: boolean | null = null;
  let context: unknown = null;
  if (runtimeEntry && effectiveOp && selectedFrom && selectedTo) {
    try {
      enabled = runtimeEntry.enabled(selectedFrom, selectedTo, state);
      context = runtimeEntry.buildContext(selectedFrom, selectedTo, state);
    } catch (error) {
      context = { error: (error as Error).message };
    }
  }

  const contextJson = context != null ? JSON.stringify(context, SERIALIZE, 2) : null;

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Operation Runtime Inspector</h1>
        <p style={{ margin: 0, opacity: 0.75, lineHeight: 1.55 }}>
          Inspect runtime availability and contexts for each operation. Provide an operation type with
          `from` / `to` asset IDs to see whether the runtime is enabled and the context it returns.
        </p>
      </header>

      <RuntimeControls
        assets={ASSETS}
        operationChoices={OPERATION_CHOICES}
        operationsMatrix={OPERATIONS_MATRIX}
        selectedOperation={selectedOperation}
        selectedFrom={selectedFrom}
        selectedTo={selectedTo}
      />

      {runtimeEntry ? (
        <section style={{ display: "grid", gap: 16, ...styles.card, padding: 16 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 18 }}>
                {selectedOperation === "auto"
                  ? `auto${effectiveOp ? ` → ${effectiveOp}` : ""}`
                  : selectedOperation}
              </div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                from {selectedFrom ?? "-"} → {selectedTo ?? "-"}
              </div>
              {selectedOperation === "auto" && impliedOps.length > 1 ? (
                <div style={{ opacity: 0.6, fontSize: 12 }}>{`Multiple operations available: ${impliedOps.join(", ")}`}</div>
              ) : null}
            </div>
            <span style={{ fontWeight: 600 }}>{enabled == null ? "" : enabled ? "Enabled" : "Disabled"}</span>
          </header>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Context</div>
            {contextJson ? (
              <pre style={{ margin: 0, padding: 12, borderRadius: 6, background: colors.bg.input, overflowX: "auto", fontSize: 13 }}>
                {contextJson}
              </pre>
            ) : (
              <div style={{ opacity: 0.6 }}>Provide `from` and `to` assets to view context data.</div>
            )}
          </div>
        </section>
      ) : (
        <section style={{ padding: 16, borderRadius: 8, border: `1px solid ${colors.border.primary}`, background: colors.bg.card }}>
          <div style={{ opacity: 0.7 }}>
            {selectedOperation === "auto" && selectedTo && impliedOps.length === 0
              ? `No runtime available for auto selection (${selectedFrom ?? "-"} → ${selectedTo}).`
              : `No runtime registered for ${effectiveOp ?? selectedOperation}.`}
          </div>
        </section>
      )}
    </div>
  );
}
