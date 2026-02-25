"use client";

import { useMemo } from "react";
import { formatTokenAmount, formatAddress } from "@/components/format";
import { colors, styles } from "@/components/theme";
import type { EvmPayload } from "@/types/api";

export function EvmWalletSection({ evm }: { evm: EvmPayload | undefined }) {
  const evmTokens = useMemo(() => evm?.tokens ?? [], [evm?.tokens]);
  const wrappedTokens = useMemo(
    () => evmTokens.filter((t) => t.symbol.toLowerCase().startsWith("w")),
    [evmTokens],
  );
  const stableTokens = useMemo(
    () => evmTokens.filter((t) => t.symbol === "USDC" || t.symbol === "USDT"),
    [evmTokens],
  );
  const otherTokens = useMemo(
    () =>
      evmTokens.filter(
        (t) => !t.symbol.toLowerCase().startsWith("w") && t.symbol !== "USDC" && t.symbol !== "USDT",
      ),
    [evmTokens],
  );

  return (
    <section
      style={{
        ...styles.section,
        display: "grid",
        gap: 12,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={styles.label}>EVM Wallet</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {evm?.address ? formatAddress(evm.address) : "\u2014"}
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color:
              evm?.status === "ok"
                ? colors.accent.green
                : evm?.status === "error"
                ? colors.accent.red
                : colors.accent.orange,
          }}
        >
          {evm?.status === "ok"
            ? "Balances synced"
            : evm?.status === "missing-address"
            ? "EVM_WALLET_ADDRESS missing"
            : evm?.status === "missing-rpc"
            ? "RPC not configured"
            : evm?.error ?? "Unknown status"}
        </div>
      </header>
      {evm?.native ? (
        <div
          style={{
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ ...styles.label, marginBottom: 2 }}>Native</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {formatTokenAmount(evm.native.balanceNumber, 6)} {evm.native.symbol}
            </div>
          </div>
          <div>
            <div style={{ ...styles.label, marginBottom: 2 }}>Network</div>
            <div>{evm.network}</div>
          </div>
          <div>
            <div style={{ ...styles.label, marginBottom: 2 }}>RPC</div>
            <div style={{ maxWidth: 380, fontSize: 12, opacity: 0.75 }}>
              {evm.rpcUrl ?? "\u2014"}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, opacity: 0.7 }}>
          Configure <code style={{ fontSize: 12 }}>EVM_WALLET_ADDRESS</code> and RPC to load balances.
        </div>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {[
          { label: "Wrapped Tokens", tokens: wrappedTokens },
          { label: "Stablecoins", tokens: stableTokens },
          ...(otherTokens.length > 0
            ? [{ label: "Other Tokens", tokens: otherTokens }]
            : []),
        ].map(({ label, tokens: groupTokens }) => (
          <div key={label}>
            <div style={{ ...styles.label, marginBottom: 8 }}>
              {label}
            </div>
            {groupTokens.length === 0 ? (
              <div style={{ fontSize: 12.5, opacity: 0.7 }}>
                No {label.toLowerCase()} available.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    ...styles.table,
                    minWidth: 520,
                    border: `1px solid ${colors.border.primary}`,
                    borderRadius: 8,
                    background: colors.bg.card,
                  }}
                >
                  <thead>
                    <tr style={styles.tableHeader}>
                      <th style={{ textAlign: "left", padding: "10px 12px" }}>Token</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Balance</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Decimals</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Address</th>
                      <th style={{ textAlign: "right", padding: "10px 12px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTokens.map((token) => (
                      <tr
                        key={token.address}
                        style={{
                          borderTop: `1px solid ${colors.border.subtle}`,
                        }}
                      >
                        <td style={{ padding: "12px" }}>
                          <div style={{ fontWeight: 600 }}>{token.symbol}</div>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>
                            {token.address}
                          </div>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {formatTokenAmount(token.balanceNumber, 6)}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          {token.decimals}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            textAlign: "right",
                            fontSize: 11,
                          }}
                        >
                          {token.key}
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            textAlign: "right",
                            fontSize: 11,
                          }}
                        >
                          {token.error ? (
                            <span style={{ color: colors.accent.red }}>{token.error}</span>
                          ) : (
                            <span style={{ color: colors.accent.green }}>ok</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
