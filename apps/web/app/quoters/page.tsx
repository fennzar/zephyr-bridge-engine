import type { AssetId, OpType } from "@domain/types";
import { buildGlobalState } from "@domain/state/state.builder";
import type { OperationQuoteRequest, OperationQuoteResponse } from "@domain/quoting/types";
import { quoteSwapOnchain, type OnchainSwapQuote } from "@domain/quoting/quoting.onchain.swap";
import { quoteSwapState } from "@domain/quoting/quoting.state.swap";
import { quoteNativeOperation } from "@domain/quoting/quoting.zephyr";
import { quoteCexTrade } from "@domain/quoting/quoting.cex";
import { quoteBridgeOperation } from "@domain/quoting/quoting.bridge";
import { OP_RUNTIME } from "@domain/runtime/operations";
import type { OperationRuntime } from "@domain/runtime/types";
import { QuoteControls } from "./QuoteControls";
import { operationsToAsset, type OperationSelection } from "../shared/operations";
import {
  QUOTER_ASSETS,
  QUOTER_OPERATION_CHOICES,
  QUOTER_OPERATIONS_MATRIX,
  QUOTER_SUPPORTED_OPS,
} from "./config";
import type { CexOperationContext } from "@domain/runtime/runtime.cex";
import type { BridgeOperationContext } from "@domain/runtime/runtime.bridge";
import type { QuoteDisplay } from "./quoteHelpers";
import { buildQuoteDisplay, parseDecimalToUnits } from "./quoteHelpers";
import { Collapsible } from "@/components/Collapsible";
import { deriveRateDisplays, type RuntimeContext } from "./rateHelpers";
import { sanitizeRuntimeContext } from "../shared/runtimeUtils";
import { colors, styles } from "@/components/theme";
import type { QuotePoolImpact, QuoteCexImpact } from "@/types/api";
import { normalizeParam, isAssetId, resolveDecimals } from "./quoters.helpers";
import { QuoteResultCard } from "./QuoteResultCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_OPS = QUOTER_SUPPORTED_OPS;
const OPERATION_CHOICES = QUOTER_OPERATION_CHOICES;
const OPERATIONS_MATRIX = QUOTER_OPERATIONS_MATRIX;

const SERIALIZE = (_: string, value: unknown) => {
  if (typeof value === "bigint") return value.toString();
  return value;
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function QuotersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const opParam = normalizeParam(params.op);
  const fromParam = normalizeParam(params.from);
  const toParam = normalizeParam(params.to);
  const amountParam = normalizeParam(params.amount);
  const amountOutParam = normalizeParam(params.amountOut);
  const sideParam = normalizeParam(params.side);

  const amountMode: "in" | "out" = sideParam === "out" || (!amountParam && amountOutParam) ? "out" : "in";
  const primaryAmountParam = amountMode === "in" ? amountParam : amountOutParam ?? amountParam;

  const selectedOperation: OperationSelection =
    opParam === "auto" ? "auto" : SUPPORTED_OPS.includes(opParam as OpType) ? (opParam as OpType) : "auto";
  const selectedFrom: AssetId | null = isAssetId(fromParam) ? fromParam : null;
  const toCandidate: AssetId | null = isAssetId(toParam) ? toParam : null;
  const selectedTo: AssetId | null = (() => {
    if (!selectedFrom || !toCandidate) return null;
    const ops = operationsToAsset(OPERATIONS_MATRIX, selectedFrom, toCandidate);
    if (ops.length === 0) return null;
    if (selectedOperation === "auto") return toCandidate;
    return ops.includes(selectedOperation) ? toCandidate : null;
  })();

  const impliedOps = selectedFrom && selectedTo ? operationsToAsset(OPERATIONS_MATRIX, selectedFrom, selectedTo) : [];
  const effectiveOp: OpType | null = selectedOperation === "auto" ? impliedOps[0] ?? null : selectedOperation;

  const amountInput = primaryAmountParam ?? "";
  const state = await buildGlobalState();

  const runtimeEntry =
    effectiveOp != null ? (OP_RUNTIME[effectiveOp] as OperationRuntime<RuntimeContext> | undefined) : undefined;
  let runtimeEnabled: boolean | null = null;
  let runtimeContext: RuntimeContext | null = null;

  if (runtimeEntry && selectedFrom && selectedTo) {
    try {
      runtimeEnabled = runtimeEntry.enabled(selectedFrom, selectedTo, state);
      runtimeContext = runtimeEntry.buildContext(selectedFrom, selectedTo, state);
    } catch {
      runtimeEnabled = null;
      runtimeContext = null;
    }
  }

  let preflightError: string | null = null;
  if (!runtimeContext) {
    preflightError = effectiveOp
      ? `${effectiveOp} runtime is unavailable for the provided assets.`
      : "Runtime is unavailable for the provided assets.";
  }

  const { from: inferredFromDecimals, to: inferredToDecimals } = resolveDecimals(
    effectiveOp,
    runtimeContext,
    selectedFrom,
    selectedTo,
  );

  let amountParseError: string | null = null;
  let amountInUnits: bigint | null = null;
  let amountOutUnits: bigint | null = null;

  if (amountInput) {
  const parseDecimals = amountMode === "in" ? inferredFromDecimals : inferredToDecimals ?? inferredFromDecimals;
    if (parseDecimals != null) {
      const parsed = parseDecimalToUnits(amountInput, parseDecimals);
      if (parsed.ok) {
        if (amountMode === "in") {
          amountInUnits = parsed.value;
        } else {
          amountOutUnits = parsed.value;
        }
      } else {
        amountParseError = parsed.error;
      }
    } else {
      amountParseError = "Decimal metadata unavailable for selected pair.";
    }
  }

  let quoteResponse: OperationQuoteResponse | null = null;
  let quoteDisplay: QuoteDisplay | null = null;
  let zeroForOne: boolean | undefined;
  let quoteError: string | null = preflightError;
  let onchainQuote: OnchainSwapQuote | null = null;

  if (
    quoteError == null &&
    effectiveOp === "swapEVM" &&
    selectedFrom &&
    selectedTo &&
    runtimeContext &&
    ((amountMode === "in" && amountInUnits != null) || (amountMode === "out" && amountOutUnits != null))
  ) {
    const request: OperationQuoteRequest = {
      op: "swapEVM",
      from: selectedFrom,
      to: selectedTo,
    };
    if (amountInUnits != null) request.amountIn = amountInUnits;
    if (amountOutUnits != null) request.amountOut = amountOutUnits;

    if (amountMode === "in") {
      try {
        onchainQuote = await quoteSwapOnchain(request, state);
        if (onchainQuote) {
          quoteResponse = {
            request,
            amountOut: onchainQuote.amountOut,
            estGasWei: onchainQuote.estGasWei,
            warnings: onchainQuote.warnings,
            poolImpact: onchainQuote.poolImpact,
          };
          zeroForOne = onchainQuote.zeroForOne;
        } else {
          quoteError = "On-chain quoter returned null for the provided request.";
        }
      } catch (error) {
        quoteError = (error as Error).message ?? "On-chain quoter error";
      }
    }

    if (!quoteResponse) {
      const stateQuote = quoteSwapState(request, state);
      if (stateQuote) {
        quoteResponse = stateQuote;
      } else if (!quoteError) {
        quoteError = "State quoter returned null for the provided request.";
      }
    }
  } else if (
    quoteError == null &&
    (effectiveOp === "nativeMint" || effectiveOp === "nativeRedeem") &&
    selectedFrom &&
    selectedTo &&
    ((amountMode === "in" && amountInUnits != null) || (amountMode === "out" && amountOutUnits != null)) &&
    runtimeContext
  ) {
    const request: OperationQuoteRequest = {
      op: effectiveOp,
      from: selectedFrom,
      to: selectedTo,
    };
    if (amountInUnits != null) request.amountIn = amountInUnits;
    if (amountOutUnits != null) request.amountOut = amountOutUnits;
    quoteResponse = quoteNativeOperation(request, state, { bypassAvailability: true });
    if (!quoteResponse) {
      quoteError = "Native quoter returned null for the provided request.";
    }
  } else if (
    quoteError == null &&
    effectiveOp === "tradeCEX" &&
    selectedFrom &&
    selectedTo &&
    runtimeContext &&
    typeof runtimeContext === "object" &&
    "direction" in runtimeContext &&
    (runtimeContext as CexOperationContext).direction === "tradeCEX" &&
    ((amountMode === "in" && amountInUnits != null) || (amountMode === "out" && amountOutUnits != null))
  ) {
    const request: OperationQuoteRequest = {
      op: "tradeCEX",
      from: selectedFrom,
      to: selectedTo,
    };
    if (amountInUnits != null) request.amountIn = amountInUnits;
    if (amountOutUnits != null) request.amountOut = amountOutUnits;

    const cexQuote = quoteCexTrade(request, state, runtimeContext as CexOperationContext);
    if (cexQuote) {
      quoteResponse = cexQuote;
    } else {
      quoteError = "CEX quoter returned null for the provided request.";
    }
  } else if (
    quoteError == null &&
    (effectiveOp === "wrap" || effectiveOp === "unwrap") &&
    selectedFrom &&
    selectedTo &&
    runtimeContext &&
    typeof runtimeContext === "object" &&
    "direction" in runtimeContext &&
    (runtimeContext as BridgeOperationContext).direction === effectiveOp &&
    ((amountMode === "in" && amountInUnits != null) || (amountMode === "out" && amountOutUnits != null))
  ) {
    const request: OperationQuoteRequest = {
      op: effectiveOp,
      from: selectedFrom,
      to: selectedTo,
    };
    if (amountInUnits != null) request.amountIn = amountInUnits;
    if (amountOutUnits != null) request.amountOut = amountOutUnits;

    const bridgeQuote = quoteBridgeOperation(request, state, runtimeContext as BridgeOperationContext);
    if (bridgeQuote) {
      quoteResponse = bridgeQuote;
    } else {
      quoteError = "Bridge quoter returned null for the provided request.";
    }
  }

  const rateDisplays = deriveRateDisplays(
    effectiveOp,
    runtimeContext,
    selectedFrom,
    selectedTo,
    state.zephyr.reserve,
  );

  const displayRuntimeContext = sanitizeRuntimeContext(effectiveOp, runtimeContext);

  if (quoteResponse) {
    quoteDisplay = buildQuoteDisplay({
      quote: quoteResponse,
      fromDecimals: inferredFromDecimals,
      toDecimals: inferredToDecimals,
      rates: rateDisplays.length > 0 ? rateDisplays : undefined,
    });
  }

  const poolImpact: QuotePoolImpact | null = quoteResponse?.poolImpact ?? null;
  const cexImpact: QuoteCexImpact | null = quoteResponse?.cexImpact ?? null;

  const inspectorData = {
    selection: {
      operation: selectedOperation === "auto" ? { mode: "auto", effective: effectiveOp } : selectedOperation,
      from: selectedFrom,
      to: selectedTo,
      amount: { mode: amountMode, value: amountInput },
    },
    runtime: {
      enabled: runtimeEnabled,
      context: displayRuntimeContext,
    },
    quote: quoteResponse,
    display: quoteDisplay,
    metadata: {
      operation: effectiveOp,
      zeroForOne,
      rates: rateDisplays,
      poolImpact,
      cexImpact,
    },
    error: quoteError,
  };

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Quoter Playground</h1>
        <p style={{ margin: 0, opacity: 0.75, lineHeight: 1.55 }}>
          Submit an operation request using human-readable token amounts. The quoter converts inputs to raw units
          automatically and returns both raw and decimal representations for easier inspection.
        </p>
      </header>

      <QuoteControls
        assets={QUOTER_ASSETS}
        operationChoices={OPERATION_CHOICES}
        operationsMatrix={OPERATIONS_MATRIX}
        selectedOperation={selectedOperation}
        selectedFrom={selectedFrom}
        selectedTo={selectedTo}
        amountValue={amountInput}
        amountPlaceholder={
          (amountMode === "in" ? inferredFromDecimals : inferredToDecimals) == null
            ? "e.g. 1.0"
            : (amountMode === "in" ? inferredFromDecimals : inferredToDecimals) === 0
              ? "e.g. 1"
              : `e.g. 1.${"0".repeat(Math.min(amountMode === "in" ? inferredFromDecimals ?? 0 : inferredToDecimals ?? 0, 2) || 1)}`
        }
        amountMode={amountMode}
      />

      {amountParseError ? (
        <section style={{ padding: 12, borderRadius: 8, border: "1px solid #3a1f2b", background: "#1f0b12", color: "#ff8a99" }}>
          {amountParseError}
        </section>
      ) : null}

      <section style={{ display: "grid", gap: 16, ...styles.card, padding: 16 }}>
      <header style={{ fontWeight: 600, fontSize: 16 }}>Quote Result</header>
      {quoteDisplay || quoteError ? (
        <div style={{ display: "grid", gap: 16 }}>
          <QuoteResultCard
            quote={quoteDisplay}
            metadata={{
              operation: effectiveOp,
              zeroForOne,
              from: selectedFrom,
              to: selectedTo,
              poolImpact,
              cexImpact,
            }}
            error={quoteError}
          />
        </div>
      ) : (
        <div style={{ opacity: 0.6 }}>Select assets and provide an amount to see the quoter response.</div>
      )}
      </section>

      <section style={{ ...styles.card, padding: 16, display: "grid", gap: 12 }}>
        <header style={{ fontWeight: 600, fontSize: 16 }}>Raw Payload</header>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Full runtime + quote context is always available here, even when a quote cannot be produced.
          </div>
          <Collapsible summary="Toggle JSON" defaultOpen>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 6,
                background: colors.bg.input,
                overflowX: "auto",
                fontSize: 13,
              }}
            >
              {JSON.stringify(inspectorData, SERIALIZE, 2)}
            </pre>
          </Collapsible>
        </div>
      </section>
    </div>
  );
}
