"use client";

import { useCallback, useState } from "react";
import { formatTokenAmount } from "@/components/format";
import { colors, styles } from "@/components/theme";

type ActionKey = "wrap" | "unwrap" | "deposit_cex" | "withdraw_cex";

type ActionDef = {
  key: ActionKey;
  title: string;
  subtitle: string;
  direction: string;
};

const ACTION_DEFS: ActionDef[] = [
  { key: "wrap", title: "Wrap", subtitle: "ZEPH.n \u2192 WZEPH.e", direction: "Native \u2192 EVM" },
  { key: "unwrap", title: "Unwrap", subtitle: "WZEPH.e \u2192 ZEPH.n", direction: "EVM \u2192 Native" },
  {
    key: "deposit_cex",
    title: "Deposit to CEX",
    subtitle: "ZEPH.n \u2192 ZEPH.x",
    direction: "Native \u2192 CEX",
  },
  {
    key: "withdraw_cex",
    title: "Withdraw from CEX",
    subtitle: "ZEPH.x \u2192 ZEPH.n",
    direction: "CEX \u2192 Native",
  },
];

const ASSET_OPTIONS = ["ZEPH", "ZSD", "ZRS", "ZYS"];

type ActionResult = {
  success: boolean;
  message: string;
  before?: Record<string, { symbol: string; amount: number }>;
  after?: Record<string, { symbol: string; amount: number }>;
};

export function InventoryActionsPanel({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [actionAssets, setActionAssets] = useState<Record<ActionKey, string>>({
    wrap: "ZEPH",
    unwrap: "ZEPH",
    deposit_cex: "ZEPH",
    withdraw_cex: "ZEPH",
  });
  const [actionAmounts, setActionAmounts] = useState<Record<ActionKey, string>>({
    wrap: "",
    unwrap: "",
    deposit_cex: "",
    withdraw_cex: "",
  });
  const [actionLoading, setActionLoading] = useState<Record<ActionKey, boolean>>({
    wrap: false,
    unwrap: false,
    deposit_cex: false,
    withdraw_cex: false,
  });
  const [actionResults, setActionResults] = useState<Record<ActionKey, ActionResult | null>>({
    wrap: null,
    unwrap: null,
    deposit_cex: null,
    withdraw_cex: null,
  });

  const handleActionExecute = useCallback(
    async (actionKey: ActionKey) => {
      const asset = actionAssets[actionKey];
      const rawAmount = actionAmounts[actionKey];
      const amount = Number.parseFloat(rawAmount);

      if (!rawAmount || !Number.isFinite(amount) || amount <= 0) {
        setActionResults((prev) => ({
          ...prev,
          [actionKey]: { success: false, message: "Enter a valid positive amount" },
        }));
        return;
      }

      setActionLoading((prev) => ({ ...prev, [actionKey]: true }));
      setActionResults((prev) => ({ ...prev, [actionKey]: null }));

      try {
        const res = await fetch("/api/inventory/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionKey, asset, amount }),
        });
        const json = await res.json();
        if (!res.ok) {
          setActionResults((prev) => ({
            ...prev,
            [actionKey]: { success: false, message: json.error ?? "Action failed" },
          }));
        } else {
          setActionResults((prev) => ({
            ...prev,
            [actionKey]: {
              success: true,
              message: `${asset} ${actionKey.replace("_", " ")}: ${amount}`,
              before: json.before,
              after: json.after,
            },
          }));
          setActionAmounts((prev) => ({ ...prev, [actionKey]: "" }));
          await onRefresh();
        }
      } catch (err) {
        setActionResults((prev) => ({
          ...prev,
          [actionKey]: {
            success: false,
            message: err instanceof Error ? err.message : "Network error",
          },
        }));
      } finally {
        setActionLoading((prev) => ({ ...prev, [actionKey]: false }));
      }
    },
    [actionAssets, actionAmounts, onRefresh],
  );

  return (
    <section
      style={{
        ...styles.section,
        display: "grid",
        gap: 12,
      }}
    >
      <div>
        <div style={styles.label}>Inventory Actions</div>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
          Move balances between venues in paper mode. Wrap/unwrap between native and EVM,
          or deposit/withdraw to the simulated CEX.
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {ACTION_DEFS.map((def) => {
          const result = actionResults[def.key];
          const isLoading = actionLoading[def.key];
          return (
            <div
              key={def.key}
              style={{
                ...styles.card,
                display: "grid",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{def.title}</div>
                <div style={{ fontSize: 11, opacity: 0.55 }}>{def.direction}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  value={actionAssets[def.key]}
                  onChange={(e) =>
                    setActionAssets((prev) => ({ ...prev, [def.key]: e.target.value }))
                  }
                  style={{
                    ...styles.input,
                    width: 90,
                    cursor: "pointer",
                  }}
                >
                  {ASSET_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Amount"
                  value={actionAmounts[def.key]}
                  onChange={(e) =>
                    setActionAmounts((prev) => ({ ...prev, [def.key]: e.target.value }))
                  }
                  style={{
                    ...styles.input,
                    flex: 1,
                    minWidth: 80,
                    textAlign: "right",
                  }}
                />
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleActionExecute(def.key)}
                  style={{
                    ...styles.button,
                    opacity: isLoading ? 0.5 : 1,
                  }}
                >
                  {isLoading ? "..." : "Execute"}
                </button>
              </div>
              <div style={{ fontSize: 11, opacity: 0.5 }}>{def.subtitle}</div>
              {result ? (
                <div
                  style={{
                    fontSize: 11,
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: result.success ? colors.accent.greenBg : colors.accent.redBg,
                    color: result.success ? colors.accent.green : colors.accent.red,
                    border: `1px solid ${result.success ? "rgba(22,199,132,0.3)" : "rgba(244,91,105,0.3)"}`,
                  }}
                >
                  <div>{result.message}</div>
                  {result.success && result.before && result.after ? (
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                      {Object.keys(result.before).map((venue) => (
                        <div key={venue}>
                          {venue}: {result.before![venue].symbol}{" "}
                          {formatTokenAmount(result.before![venue].amount, 4)}
                          {" \u2192 "}
                          {formatTokenAmount(result.after![venue].amount, 4)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
