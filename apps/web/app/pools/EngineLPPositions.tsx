import type { PositionOverview } from "@services";
import { colors, styles } from "@/components/theme";
import {
  formatNumber,
  formatCurrency,
  formatRelativeTime,
} from "@/components/format";
import type { EngineLPPosition } from "./pools.helpers";
import { StatusBadge } from "./pools.helpers";

export function EngineLPPositions({
  walletAddr,
  positions,
  enginePositions,
  engineDataMap,
}: {
  walletAddr: string | undefined;
  positions: PositionOverview[];
  enginePositions: EngineLPPosition[];
  engineDataMap: Map<string, EngineLPPosition>;
}) {
  return (
    <>
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>
          Engine LP Positions
          {walletAddr ? (
            <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 8, fontWeight: 400 }}>
              {walletAddr.slice(0, 6)}...{walletAddr.slice(-4)}
            </span>
          ) : null}
        </h2>
        {!walletAddr ? (
          <div
            style={{
              ...styles.card,
              padding: 16,
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            Set <code>EVM_WALLET_ADDRESS</code> to view LP positions.
          </div>
        ) : positions.length === 0 ? (
          <div
            style={{
              ...styles.card,
              padding: 16,
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            No LP positions found for engine wallet. Run{" "}
            <code>make seed-engine</code> to add liquidity.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                ...styles.table,
                minWidth: 600,
                background: colors.bg.card,
                border: `1px solid ${colors.border.primary}`,
                borderRadius: 8,
              }}
            >
              <thead>
                <tr style={styles.tableHeader}>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Pool</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Tick Range</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Notional (USD)</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Fees (USD)</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>In Range</th>
                  <th style={{ textAlign: "center", padding: "10px 12px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Target Mode</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Last Rebalance</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const engineKey = `${pos.poolId}:${pos.tickLower}:${pos.tickUpper}`;
                  const engineData = engineDataMap.get(engineKey);
                  return (
                    <tr
                      key={pos.id}
                      style={{ borderTop: `1px solid ${colors.border.subtle}` }}
                    >
                      <td style={{ padding: "12px" }}>
                        <div style={{ fontWeight: 600 }}>
                          {pos.token0.symbol}/{pos.token1.symbol}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>
                          #{pos.id}
                        </div>
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                        {pos.tickLower} \u2014 {pos.tickUpper}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {pos.notionalUsd > 0
                          ? formatCurrency(pos.notionalUsd)
                          : "\u2014"}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        {pos.feesUsd > 0 ? formatCurrency(pos.feesUsd) : "\u2014"}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        <span
                          style={{
                            color: pos.isInRange ? colors.accent.green : colors.accent.red,
                            fontSize: 11,
                          }}
                        >
                          {pos.isInRange ? "Yes" : "No"}
                        </span>
                      </td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        {engineData ? (
                          <StatusBadge status={engineData.status} />
                        ) : (
                          <span style={{ fontSize: 11, opacity: 0.4 }}>\u2014</span>
                        )}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                        {engineData?.targetMode ?? "\u2014"}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                        {engineData?.lastRebalanceAt
                          ? formatRelativeTime(engineData.lastRebalanceAt)
                          : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Standalone engine LP positions not matched to on-chain positions */}
      {enginePositions.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>
            Engine-Managed Positions (DB)
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                ...styles.table,
                minWidth: 600,
                background: colors.bg.card,
                border: `1px solid ${colors.border.primary}`,
                borderRadius: 8,
              }}
            >
              <thead>
                <tr style={styles.tableHeader}>
                  <th style={{ textAlign: "left", padding: "10px 12px" }}>Pool</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Tick Range</th>
                  <th style={{ textAlign: "center", padding: "10px 12px" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Target Mode</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Liquidity</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Last Rebalance</th>
                  <th style={{ textAlign: "right", padding: "10px 12px" }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {enginePositions.map((ep) => (
                  <tr
                    key={ep.id}
                    style={{ borderTop: `1px solid ${colors.border.subtle}` }}
                  >
                    <td style={{ padding: "12px" }}>
                      <div style={{ fontWeight: 600 }}>
                        {ep.pool?.token0?.symbol ?? "?"}/{ep.pool?.token1?.symbol ?? "?"}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        {ep.id}
                      </div>
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                      {ep.tickLower} \u2014 {ep.tickUpper}
                    </td>
                    <td style={{ padding: "12px", textAlign: "center" }}>
                      <StatusBadge status={ep.status} />
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                      {ep.targetMode ?? "\u2014"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                      {ep.liquidity !== "0"
                        ? formatNumber(parseFloat(ep.liquidity), 2)
                        : "\u2014"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                      {ep.lastRebalanceAt
                        ? formatRelativeTime(ep.lastRebalanceAt)
                        : "\u2014"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right", fontSize: 12 }}>
                      {formatRelativeTime(ep.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
