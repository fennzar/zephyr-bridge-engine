import type { AssetId } from "@domain/types";
import { buildGlobalState } from "@domain/state/state.builder";
import { buildQuoterAwareSegmentPreparation, type QuoterAwareSegmentPlan } from "@domain/pathing/arb";
import { loadInventoryBalances } from "@domain/pathing";

import {
  parseLegParams,
  buildAssetChoices,
  buildDirectionChoices,
  buildSegmentChoices,
  segmentLabel,
  renderAmount,
  summarizeCandidates,
  pickFirst,
} from "./legPrep.helpers";
import { LegSelectionForm } from "./LegSelectionForm";
import { SegmentSummary, SegmentCandidates } from "./CandidateCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ArbLegPreparationPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = ((await searchParams) ?? {}) as SearchParams;
  const parsed = parseLegParams(params);
  const errors = [...parsed.errors];

  const amountOverrides =
    parsed.amountInOverride != null
      ? ({ [parsed.legChoice.need]: parsed.amountInOverride } as Partial<Record<AssetId, bigint>>)
      : undefined;

  let plan: QuoterAwareSegmentPlan | null = null;
  if (errors.length === 0) {
    const [state, inventoryBalances] = await Promise.all([
      buildGlobalState(),
      loadInventoryBalances(),
    ]);
    plan = await buildQuoterAwareSegmentPreparation(
      {
        asset: parsed.asset,
        direction: parsed.direction,
        kind: parsed.legChoice.kind,
        stepIndex: parsed.legChoice.index,
      },
      state,
      {
        maxDepth: parsed.maxDepth,
        pathLimit: parsed.pathLimit,
        amountOverrides,
        inventoryBalances,
      },
    );
  }

  const assetChoices = buildAssetChoices();
  const directionChoices = buildDirectionChoices(parsed.asset);
  const legChoices = buildSegmentChoices(parsed.asset, parsed.direction);
  const selectedValue = parsed.legChoice.value;
  const summary = plan ? summarizeCandidates(plan.step.candidates) : null;

  return (
    <div style={{ display: "grid", gap: 24, padding: 24, maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>Quoter-Aware Arb Leg Preparation</h1>
          <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.6 }}>
            Evaluate each arbitrage leg&apos;s open and close preparations with runtime policy, quote context, and
            allowance-aware scoring. Amount overrides let you probe the paths for a representative trade size.
          </p>
        </div>

        <LegSelectionForm
          parsed={parsed}
          params={params}
          assetChoices={assetChoices}
          directionChoices={directionChoices}
          legChoices={legChoices}
          selectedValue={selectedValue}
        />

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

        {plan && summary && (
          <section style={{ display: "grid", gap: 18 }}>
            <header style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  {plan.asset} ({plan.direction.replace("_", " ")})
                </h2>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {segmentLabel(plan.kind)} · Step {plan.stepIndex + 1} &mdash; need asset {parsed.legChoice.need}
                </div>
              </div>
              {parsed.amountInOverride != null ? (
                <div style={{ textAlign: "right", fontSize: 12, opacity: 0.8 }}>
                  <div>Probe amount</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {renderAmount(parsed.amountInOverride, parsed.legChoice.need)}
                  </div>
                </div>
              ) : null}
            </header>

            <SegmentSummary step={plan.step} summary={summary} />
            <SegmentCandidates step={plan.step} needAsset={parsed.legChoice.need} summary={summary} />
          </section>
        )}
      </div>
    </div>
  );
}
