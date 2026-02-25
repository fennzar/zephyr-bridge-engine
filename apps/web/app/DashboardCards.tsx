import type {
  PoolOverview,
  PoolDiscoveryLog,
  MexcDepthSummary,
} from "@services";
import {
  ZsdLogo,
  ZrsLogo,
  ZysLogo,
  YieldReserve,
  Reserve,
} from "@/components/LogoSvgs";
import type { ReserveState } from "@domain/zephyr";
import { colors, styles } from "@/components/theme";
import {
  formatUsd,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatTimestamp,
  formatAddress,
  formatHash,
} from "@/components/format";
import { PolicyBadge } from "./_components/PolicyBadge";
import { renderRateSummary, renderUsdSpot } from "./_components/RateSummary";

export function LiquidityStatusCard({ pools }: { pools: PoolOverview[] }) {
  const poolsWithTvl = pools.filter((p) => p.tvlUsd > 0);
  const totalTvl = pools.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0);
  const seeded = poolsWithTvl.length > 0;

  return (
    <section style={styles.section}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Liquidity Status
      </div>
      <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ opacity: 0.7 }}>Seed Status</span>
          <span
            style={{
              fontSize: 12,
              padding: "3px 10px",
              borderRadius: 999,
              border: `1px solid ${seeded ? "#16c784" : "#666"}`,
              color: seeded ? "#16c784" : "#888",
            }}
          >
            {seeded ? "Seeded" : "Not Seeded"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ opacity: 0.7 }}>Total TVL</span>
          <span>{formatCurrency(totalTvl)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ opacity: 0.7 }}>Active Pools</span>
          <span>
            {poolsWithTvl.length}/{pools.length}
          </span>
        </div>
        {pools.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${colors.border.subtle}`,
              paddingTop: 10,
              display: "grid",
              gap: 6,
              fontSize: 13,
            }}
          >
            {pools.map((pool) => (
              <div
                key={pool.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ opacity: 0.7 }}>
                  {pool.base.symbol}/{pool.quote.symbol}
                </span>
                <span>{formatCurrency(pool.tvlUsd)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function MexcCard({ mexcMarket }: { mexcMarket: MexcDepthSummary | null }) {
  return (
    <section style={styles.section}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        MEXC ZEPH/USDT
      </div>
      {mexcMarket ? (
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ opacity: 0.7 }}>Bid</span>
            <span style={{ color: "#48e1a9" }}>
              {mexcMarket.bestBid.toFixed(4)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ opacity: 0.7 }}>Ask</span>
            <span style={{ color: "#f7ad4c" }}>
              {mexcMarket.bestAsk.toFixed(4)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ opacity: 0.7 }}>Spread</span>
            <span>{`${mexcMarket.spread.toFixed(4)} (${mexcMarket.spreadBps.toFixed(2)} bps)`}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ opacity: 0.7 }}>Depth (bid/ask)</span>
            <span>
              {`${formatUsd(mexcMarket.depthUsd.bidUsd)} / ${formatUsd(mexcMarket.depthUsd.askUsd)}`}
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>
            {new Date(mexcMarket.generatedAt).toLocaleString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
        </div>
      ) : (
        <div style={{ opacity: 0.7, fontSize: 14 }}>
          Failed to load MEXC depth.
        </div>
      )}
    </section>
  );
}

export function RecentPoolEventsCard({ recentEvents }: { recentEvents: PoolDiscoveryLog[] }) {
  return (
    <section style={styles.section}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Recent Pool Events
      </div>
      {recentEvents.length === 0 ? (
        <div style={{ fontSize: 14, opacity: 0.7 }}>
          No pool discovery events recorded yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              minWidth: 640,
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={styles.tableHeader}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Time
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Pool
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Pair
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Fee (bps)
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Block
                </th>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Tx
                </th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((event) => (
                <tr
                  key={event.id}
                  style={{ borderTop: `1px solid ${colors.border.subtle}` }}
                >
                  <td style={{ padding: "8px 8px" }}>
                    {formatTimestamp(event.blockTimestamp)}
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    {event.poolAddress
                      ? formatAddress(event.poolAddress)
                      : "\u2014"}
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    {event.token0 && event.token1
                      ? `${event.token0.symbol}/${event.token1.symbol}`
                      : "\u2014"}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>
                    {event.feeTierBps != null ? event.feeTierBps : "\u2014"}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>
                    {event.blockNumber.toLocaleString()}
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <code style={{ fontSize: 11 }}>
                      {formatHash(event.txHash)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ZephyrNetworkCard({ zephyrState }: { zephyrState: ReserveState | null }) {
  if (!zephyrState) {
    return (
      <section style={styles.section}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>
          Zephyr Network
        </div>
        <div style={{ opacity: 0.7, fontSize: 14 }}>
          Failed to load Zephyr network state.
        </div>
      </section>
    );
  }

  const reserveRows = [
    {
      label: "ZEPH Reserve",
      value: formatNumber(zephyrState.zephInReserve, 2),
      Icon: Reserve,
    },
    {
      label: "ZSD in Yield Reserve",
      value: formatNumber(zephyrState.zsdInYieldReserve, 2),
      Icon: YieldReserve,
    },
  ];

  const assetRows = [
    {
      token: "ZRS",
      price: (
        <div style={{ display: "grid", gap: 4 }}>
          {renderRateSummary("vs ZEPH", zephyrState.rates.zrs)}
          {renderUsdSpot("USD spot", zephyrState.rates.zrs.spotUSD)}
        </div>
      ),
      circ: formatNumber(zephyrState.zrsCirc, 2),
      mintable: zephyrState.policy.zrs.mintable,
      redeemable: zephyrState.policy.zrs.redeemable,
      Icon: ZrsLogo,
    },
    {
      token: "ZSD",
      price: (
        <div style={{ display: "grid", gap: 4 }}>
          {renderRateSummary("vs ZEPH", zephyrState.rates.zsd)}
          {renderUsdSpot("USD spot", zephyrState.rates.zsd.spotUSD)}
        </div>
      ),
      circ: formatNumber(zephyrState.zsdCirc, 2),
      mintable: zephyrState.policy.zsd.mintable,
      redeemable: zephyrState.policy.zsd.redeemable,
      Icon: ZsdLogo,
    },
    {
      token: "ZYS",
      price: (
        <div style={{ display: "grid", gap: 4 }}>
          {renderRateSummary("vs ZSD", zephyrState.rates.zys)}
          {renderUsdSpot("USD spot", zephyrState.rates.zys.spotUSD)}
        </div>
      ),
      circ: formatNumber(zephyrState.zysCirc, 2),
      mintable: true,
      redeemable: true,
      Icon: ZysLogo,
    },
  ];

  return (
    <section style={styles.section}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>
        Zephyr Network
      </div>
      <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ opacity: 0.7 }}>Height</span>
          <span>{zephyrState.height.toLocaleString()}</span>
        </div>
        {assetRows.length > 0 && (
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={styles.tableHeader}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>
                  Asset
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Price
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Circulating
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Mint
                </th>
                <th style={{ textAlign: "right", padding: "6px 8px" }}>
                  Redeem
                </th>
              </tr>
            </thead>
            <tbody>
              {assetRows.map(
                ({ token, price, circ, mintable, redeemable, Icon }) => (
                  <tr
                    key={token}
                    style={{
                      borderTop: `1px solid ${colors.border.subtle}`,
                    }}
                  >
                    <td style={{ padding: "8px 8px" }}>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Icon size={28} />
                        <span style={{ fontWeight: 600 }}>{token}</span>
                      </span>
                    </td>
                    <td
                      style={{ padding: "8px 8px", textAlign: "right" }}
                    >
                      {price}
                    </td>
                    <td
                      style={{ padding: "8px 8px", textAlign: "right" }}
                    >
                      {circ}
                    </td>
                    <td
                      style={{ padding: "8px 8px", textAlign: "right" }}
                    >
                      {token === "ZYS" ? (
                        "\u2014"
                      ) : (
                        <PolicyBadge ok={mintable} />
                      )}
                    </td>
                    <td
                      style={{ padding: "8px 8px", textAlign: "right" }}
                    >
                      {token === "ZYS" ? (
                        "\u2014"
                      ) : (
                        <PolicyBadge ok={redeemable} />
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
        {reserveRows.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            {reserveRows.map(({ label, value, Icon }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    opacity: 0.7,
                  }}
                >
                  <Icon size={28} />
                  {label}
                </span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ opacity: 0.7 }}>Reserve Ratio</span>
          <span>{formatPercent(zephyrState.reserveRatio, 2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ opacity: 0.7 }}>Reserve Ratio (MA)</span>
          <span>
            {formatPercent(zephyrState.reserveRatioMovingAverage, 2)}
          </span>
        </div>
      </div>
    </section>
  );
}
