"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTokenAmount } from "@/components/format";
import { colors, styles } from "@/components/theme";
import type { BalancesResponse } from "@/types/api";

type PaperSource = "mexc" | "zephyr";

type Feedback = { type: "success" | "error"; message: string };

type PaperSourceMeta = {
  key: PaperSource;
  label: string;
  helper: string;
  envKey: keyof BalancesResponse["config"];
  envVar: string;
};

const PAPER_SOURCES: PaperSourceMeta[] = [
  {
    key: "mexc",
    label: "MEXC Paper Wallet",
    helper: "Simulated CEX balances for testing trade flows.",
    envKey: "mexcPaper",
    envVar: "MEXC_PAPER",
  },
  {
    key: "zephyr",
    label: "Zephyr Native Paper",
    helper: "Mock native-chain balances used during dry runs.",
    envKey: "zephyrPaper",
    envVar: "ZEPHYR_PAPER",
  },
];

function sortBalances(data: Record<string, number>): Array<[string, number]> {
  return Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
}

export function PaperBalanceSection({
  data,
  onRefresh,
}: {
  data: BalancesResponse | null;
  onRefresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [drafts, setDrafts] = useState<Record<PaperSource, Record<string, string>>>({
    mexc: {},
    zephyr: {},
  });
  const [newEntries, setNewEntries] = useState<
    Record<PaperSource, { asset: string; amount: string }>
  >({
    mexc: { asset: "", amount: "" },
    zephyr: { asset: "", amount: "" },
  });

  useEffect(() => {
    if (!data) return;
    setDrafts({
      mexc: Object.fromEntries(
        Object.entries(data.paper.mexc).map(([asset, amount]) => [asset, amount.toString()]),
      ),
      zephyr: Object.fromEntries(
        Object.entries(data.paper.zephyr).map(([asset, amount]) => [asset, amount.toString()]),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.paper.mexc, data?.paper.zephyr]);

  const handleDraftChange = useCallback(
    (source: PaperSource, asset: string, value: string) => {
      setDrafts((prev) => ({
        ...prev,
        [source]: {
          ...prev[source],
          [asset]: value,
        },
      }));
    },
    [],
  );

  const handleNewEntryChange = useCallback(
    (source: PaperSource, field: "asset" | "amount", value: string) => {
      setNewEntries((prev) => ({
        ...prev,
        [source]: {
          ...prev[source],
          [field]: value,
        },
      }));
    },
    [],
  );

  const handlePaperUpdate = useCallback(
    async (source: PaperSource, asset: string, rawAmount: string) => {
      const normalizedAsset = asset.trim().toUpperCase();
      if (!normalizedAsset) {
        setFeedback({ type: "error", message: "Asset symbol cannot be empty" });
        return;
      }
      const amount = Number.parseFloat(rawAmount);
      if (!Number.isFinite(amount)) {
        setFeedback({ type: "error", message: "Amount must be a number" });
        return;
      }

      setSaving(true);
      try {
        const res = await fetch("/api/balances/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, asset: normalizedAsset, amount }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Update failed (${res.status})`);
        }
        setFeedback({
          type: "success",
          message: `${source.toUpperCase()} ${normalizedAsset} updated to ${amount}`,
        });
        await onRefresh();
      } catch (err) {
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to update paper balance",
        });
      } finally {
        setSaving(false);
      }
    },
    [onRefresh],
  );

  const handleAddNew = useCallback(
    async (source: PaperSource) => {
      const { asset, amount } = newEntries[source];
      await handlePaperUpdate(source, asset, amount);
      setNewEntries((prev) => ({
        ...prev,
        [source]: { asset: "", amount: "" },
      }));
    },
    [handlePaperUpdate, newEntries],
  );

  return (
    <>
      {saving ? <span style={{ fontSize: 12, opacity: 0.7 }}>Saving...</span> : null}
      {feedback ? (
        <span
          style={{
            fontSize: 12,
            color: feedback.type === "success" ? colors.accent.green : colors.accent.red,
          }}
        >
          {feedback.message}
        </span>
      ) : null}

      {PAPER_SOURCES.map(({ key, label, helper, envKey, envVar }) => {
        const balances = data?.paper?.[key] ?? {};
        const entries = sortBalances(balances);
        const hasEntries = entries.length > 0;
        const paperEnabled = Boolean(data?.config?.[envKey]);
        const badgeColor = paperEnabled ? colors.accent.green : colors.accent.orange;
        const badgeLabel = paperEnabled ? "Paper mode enabled" : "Paper mode disabled";
        return (
          <section
            key={key}
            style={{
              ...styles.section,
              display: "grid",
              gap: 12,
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={styles.label}>{label}</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>{helper}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  Controlled by <code style={{ fontSize: 11 }}>{envVar}</code>
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${badgeColor}`,
                  color: badgeColor,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {badgeLabel}
              </span>
            </header>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {paperEnabled
                ? "Simulated balances will be applied during paper executions."
                : "Paper mode is disabled\u2014values below are for reference until enabled."}
            </div>

            {hasEntries ? (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    ...styles.table,
                    minWidth: 480,
                    border: `1px solid ${colors.border.primary}`,
                    borderRadius: 8,
                    background: colors.bg.card,
                  }}
                >
                  <thead>
                    <tr style={styles.tableHeader}>
                      <th style={{ textAlign: "left", padding: "10px 12px" }}>Asset</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Current</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Set Paper</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(([asset, amount]) => (
                      <tr
                        key={`${key}-${asset}`}
                        style={{ borderTop: `1px solid ${colors.border.subtle}` }}
                      >
                        <td style={{ padding: "12px" }}>
                          <div style={{ fontWeight: 600 }}>{asset}</div>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {formatTokenAmount(amount, 6)}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <input
                            value={drafts[key]?.[asset] ?? ""}
                            onChange={(event) =>
                              handleDraftChange(key, asset, event.currentTarget.value)
                            }
                            style={{
                              ...styles.input,
                              width: 120,
                              textAlign: "right",
                            }}
                          />
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => handlePaperUpdate(key, asset, drafts[key]?.[asset] ?? "")}
                            style={styles.button}
                          >
                            Update
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, opacity: 0.7 }}>
                No balances set yet. Add an asset below to seed the paper ledger.
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: 8,
                border: `1px dashed ${colors.border.input}`,
                borderRadius: 8,
                padding: 12,
                background: "rgba(16,23,32,0.6)",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.6 }}>Add or overwrite balance</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  placeholder="Asset (e.g. ZEPH)"
                  value={newEntries[key].asset}
                  onChange={(event) => handleNewEntryChange(key, "asset", event.currentTarget.value)}
                  style={{
                    ...styles.input,
                    flex: "1 1 140px",
                    minWidth: 120,
                  }}
                />
                <input
                  placeholder="Amount"
                  value={newEntries[key].amount}
                  onChange={(event) => handleNewEntryChange(key, "amount", event.currentTarget.value)}
                  style={{
                    ...styles.input,
                    width: 140,
                    textAlign: "right",
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleAddNew(key)}
                  style={styles.button}
                >
                  Save
                </button>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                Values persist to <code style={{ fontSize: 11 }}>data/paper-balances.json</code>. Use this to
                mirror expected wallet balances during simulated fills.
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
