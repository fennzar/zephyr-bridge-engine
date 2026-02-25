"use client";

import type { EvaluationResult } from "@/types/api";
import { colors, styles } from "@/components/theme";
import { Badge } from "./engine.helpers";

export function EvaluationPanel({
  evaluation,
  evaluating,
  onRunEvaluation,
}: {
  evaluation: EvaluationResult | null;
  evaluating: boolean;
  onRunEvaluation: () => void;
}) {
  return (
    <div style={styles.section}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Strategy Evaluation
        </span>
        <button
          type="button"
          onClick={onRunEvaluation}
          disabled={evaluating}
          style={{
            ...styles.buttonPrimary,
            opacity: evaluating ? 0.5 : 1,
          }}
        >
          {evaluating ? "Evaluating..." : "Run Evaluation"}
        </button>
      </div>

      {evaluation && (
        <div style={{ display: "grid", gap: 12 }}>
          {evaluation.state && (
            <div style={{ ...styles.card, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, fontSize: 13 }}>
              <div>
                <span style={{ opacity: 0.5 }}>RR: </span>
                <span style={{ fontWeight: 500 }}>
                  {evaluation.state.reserveRatio.toFixed(0)}%
                </span>
              </div>
              <div>
                <span style={{ opacity: 0.5 }}>RR MA: </span>
                <span style={{ fontWeight: 500 }}>
                  {evaluation.state.reserveRatioMa.toFixed(0)}%
                </span>
              </div>
              <div>
                <span style={{ opacity: 0.5 }}>ZEPH: </span>
                <span style={{ fontWeight: 500 }}>
                  ${evaluation.state.zephPrice.toFixed(4)}
                </span>
              </div>
              <div>
                <span style={{ opacity: 0.5 }}>Mode: </span>
                <Badge
                  label={evaluation.state.rrMode.toUpperCase()}
                  status={evaluation.state.rrMode}
                />
              </div>
            </div>
          )}

          {Object.entries(evaluation.results).map(
            ([strategyId, result]) => (
              <div key={strategyId} style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>
                  {strategyId.toUpperCase()} \u2014{" "}
                  {result.opportunities.length} opportunities
                </div>

                {result.warnings && result.warnings.length > 0 && (
                  <div
                    style={{
                      ...styles.card,
                      background: colors.accent.orangeBg,
                      border: "1px solid rgba(247,173,76,0.3)",
                      color: colors.accent.orange,
                      fontSize: 12,
                    }}
                  >
                    {result.warnings.map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                  </div>
                )}

                {result.opportunities.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.4 }}>
                    No opportunities found
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    {result.opportunities.map((opp) => (
                      <div
                        key={opp.id}
                        style={{
                          ...styles.card,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>
                            {opp.asset} \u2014 {opp.direction}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.5 }}>
                            {opp.trigger}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontWeight: 500,
                              color:
                                opp.expectedPnl > 0
                                  ? colors.accent.green
                                  : colors.accent.red,
                            }}
                          >
                            ${opp.expectedPnl.toFixed(2)}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.4 }}>
                            {opp.urgency}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 11,
                    opacity: 0.4,
                    flexWrap: "wrap",
                  }}
                >
                  {Object.entries(result.metrics).map(([key, value]) => (
                    <span key={key}>
                      {key}:{" "}
                      {typeof value === "number" ? value.toFixed(2) : value}
                    </span>
                  ))}
                </div>
              </div>
            ),
          )}

          {evaluation.errors && evaluation.errors.length > 0 && (
            <div
              style={{
                ...styles.card,
                background: colors.accent.redBg,
                border: "1px solid rgba(244,91,105,0.3)",
                color: colors.accent.red,
                fontSize: 12,
              }}
            >
              {evaluation.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
