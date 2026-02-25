"use client";

import { useState, useEffect, useCallback } from "react";
import { colors, styles } from "@/components/theme";

// ============================================================================
// Types
// ============================================================================

interface PaperSubaddress {
  id: string;
  addressIndex: number;
  address: string;
  zephBalance: number;
  label: string | null;
}

interface PaperAccount {
  id: string;
  accountNumber: number;
  name: string;
  usdtBalance: number;
  zephBalance: number;
  subaddress: PaperSubaddress | null;
}

interface ExchangeSummary {
  totalZeph: number;
  totalUsdt: number;
  unlockedZeph: number;
  walletHeight: number;
  accountCount: number;
  subaddressCount: number;
  walletMismatch: boolean;
  expectedWallet: string | null;
  connectedWallet: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return value.toFixed(decimals);
  if (value === 0) return "0";
  return value.toFixed(Math.min(decimals + 2, 6));
}

function truncateAddress(address: string, chars = 8): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

// ============================================================================
// Component
// ============================================================================

export default function ExchangePage() {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [summary, setSummary] = useState<ExchangeSummary | null>(null);
  const [walletReady, setWalletReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUsdt, setEditingUsdt] = useState<number | null>(null);
  const [usdtInput, setUsdtInput] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/exchange/api");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAccounts(data.accounts || []);
      setSummary(data.summary || null);
      setWalletReady(data.walletReady ?? false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleAction = async (action: string, params: Record<string, unknown> = {}) => {
    const key = `${action}-${params.accountNumber ?? "all"}`;
    setActionLoading(key);
    try {
      const res = await fetch("/exchange/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateSubaddress = (accountNumber: number) => {
    handleAction("createSubaddress", { accountNumber });
  };

  const handleSetUsdtBalance = (accountNumber: number) => {
    const amount = parseFloat(usdtInput);
    if (isNaN(amount) || amount < 0) {
      setError("Invalid USDT amount");
      return;
    }
    handleAction("setUsdtBalance", { accountNumber, amount });
    setEditingUsdt(null);
    setUsdtInput("");
  };

  const handleSyncBalances = () => handleAction("syncBalances");
  const handleScanDeposits = () => handleAction("scanDeposits");
  const handleResetAll = () => {
    if (confirm("Reset all accounts? This will delete all subaddresses and trade history.")) {
      handleAction("resetAll");
    }
  };

  if (loading) {
    return (
      <main style={{ maxWidth: 960, margin: "48px auto", padding: 24 }}>
        <div style={{ opacity: 0.7 }}>Loading exchange...</div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 960, margin: "48px auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Paper Exchange</h1>
      <div style={{ opacity: 0.7, marginBottom: 8 }}>
        Simulated CEX for ZEPH/USDT • {walletReady ? (
          <span style={{ color: colors.accent.green }}>Wallet Online</span>
        ) : (
          <span style={{ color: colors.accent.red }}>Wallet Offline</span>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: 6,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fca5a5",
          fontSize: 13,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Wallet Mismatch Warning */}
      {summary?.walletMismatch && (
        <div style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "rgba(245, 158, 11, 0.1)",
          border: "1px solid rgba(245, 158, 11, 0.3)",
          borderRadius: 6,
          color: "#fcd34d",
          fontSize: 13,
        }}>
          ⚠️ <strong>Wallet Mismatch!</strong> Expected: {truncateAddress(summary.expectedWallet || "", 10)} but connected to: {truncateAddress(summary.connectedWallet || "", 10)}
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {/* Summary Card */}
        <section style={styles.section}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Wallet Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16, fontSize: 14 }}>
            <div>
              <div style={styles.label}>Total ZEPH</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(summary?.totalZeph, 4)}</div>
            </div>
            <div>
              <div style={styles.label}>Unlocked</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(summary?.unlockedZeph, 4)}</div>
            </div>
            <div>
              <div style={styles.label}>Total USDT</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>${formatNumber(summary?.totalUsdt, 2)}</div>
            </div>
            <div>
              <div style={styles.label}>Height</div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>{summary?.walletHeight?.toLocaleString() ?? "—"}</div>
            </div>
            <div>
              <div style={styles.label}>Subaddresses</div>
              <div>{summary?.subaddressCount ?? 0}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border.subtle}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleScanDeposits}
              style={styles.button}
              disabled={actionLoading !== null || !walletReady}
            >
              Scan Deposits
            </button>
            <button
              onClick={handleSyncBalances}
              style={styles.button}
              disabled={actionLoading !== null || !walletReady}
            >
              Sync Balances
            </button>
            <button
              onClick={handleResetAll}
              style={{ padding: "6px 12px", background: colors.accent.redBg, border: "1px solid rgba(244,91,105,0.3)", borderRadius: 4, color: "#fca5a5", cursor: "pointer", fontSize: 12 }}
              disabled={actionLoading !== null}
            >
              Reset All
            </button>
          </div>
        </section>

        {/* Accounts */}
        <section style={styles.section}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Accounts</div>
          <div style={{ display: "grid", gap: 8 }}>
            {accounts.map((account) => (
              <div
                key={account.id}
                style={{
                  padding: 12,
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>#{account.accountNumber}</span>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>{account.name}</span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                  {/* ZEPH Column */}
                  <div>
                    <div style={{ ...styles.label, marginBottom: 4 }}>ZEPH Balance</div>
                    <div style={{ fontVariantNumeric: "tabular-nums", color: "#48e1a9" }}>
                      {formatNumber(account.zephBalance, 4)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <div style={{ ...styles.label, marginBottom: 4 }}>Deposit Address</div>
                      {account.subaddress ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <code style={{ fontSize: 11, color: colors.accent.green }}>{truncateAddress(account.subaddress.address, 8)}</code>
                          <button
                            onClick={() => account.subaddress && navigator.clipboard.writeText(account.subaddress.address)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, opacity: 0.7 }}
                            title="Copy address"
                          >
                            📋
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleCreateSubaddress(account.accountNumber)}
                          style={styles.button}
                          disabled={actionLoading === `createSubaddress-${account.accountNumber}` || !walletReady}
                        >
                          {actionLoading === `createSubaddress-${account.accountNumber}` ? "..." : "Generate"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* USDT Column */}
                  <div>
                    <div style={{ ...styles.label, marginBottom: 4 }}>USDT Balance</div>
                    {editingUsdt === account.accountNumber ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="number"
                          value={usdtInput}
                          onChange={(e) => setUsdtInput(e.target.value)}
                          style={{
                            width: 80,
                            padding: "3px 6px",
                            background: colors.bg.body,
                            border: `1px solid ${colors.border.input}`,
                            borderRadius: 4,
                            color: colors.text.primary,
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSetUsdtBalance(account.accountNumber);
                            if (e.key === "Escape") setEditingUsdt(null);
                          }}
                        />
                        <button
                          onClick={() => handleSetUsdtBalance(account.accountNumber)}
                          style={{ padding: "3px 6px", background: colors.accent.green, border: "none", borderRadius: 3, color: "#fff", cursor: "pointer", fontSize: 11 }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingUsdt(null)}
                          style={{ padding: "3px 6px", background: "#64748b", border: "none", borderRadius: 3, color: "#fff", cursor: "pointer", fontSize: 11 }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{ fontVariantNumeric: "tabular-nums", color: colors.accent.orange, cursor: "pointer" }}
                        onClick={() => {
                          setEditingUsdt(account.accountNumber);
                          setUsdtInput(account.usdtBalance.toString());
                        }}
                        title="Click to edit"
                      >
                        ${formatNumber(account.usdtBalance, 2)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.5, textAlign: "center" }}>
        Paper trading mode • Uses real Zephyr wallet RPC for deposit addresses
      </div>
    </main>
  );
}
