export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import type { CSSProperties } from 'react';
import { evm, type PositionOverview } from '@services';
import { colors, styles } from '@/components/theme';
import { formatUsd as formatUsdUtil, formatTimestamp } from '@/components/format';

const headerCellStyles: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: `1px solid ${colors.border.subtle}`,
  fontWeight: 600,
  ...styles.tableHeader,
};

const cellStyles: CSSProperties = {
  padding: '10px',
  borderBottom: `1px solid ${colors.border.subtle}`,
  verticalAlign: 'middle',
};

function formatRange(position: PositionOverview): string {
  return `${position.tickLower} \u2192 ${position.tickUpper}`;
}

export default async function PositionsPage() {
  // TODO: plug actual owner address or read from session
  const owner: `0x${string}` = '0x0000000000000000000000000000000000000000';
  const positions = await evm.getPositions(null, owner);

  return (
    <main style={styles.pageContainer}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Uniswap v4 Positions</h1>
      {positions.length === 0 ? (
        <div style={{ opacity: 0.7 }}>
          No demo positions yet. Plug real discovery logic in <code>src/services/evm/uniswapV4.ts</code>.
        </div>
      ) : (
        <section style={{ border: `1px solid ${colors.border.primary}`, borderRadius: 8, background: colors.bg.section }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={headerCellStyles}>Pool</th>
                <th style={headerCellStyles}>Range</th>
                <th style={headerCellStyles}>Liquidity</th>
                <th style={headerCellStyles}>Notional</th>
                <th style={headerCellStyles}>Fees</th>
                <th style={headerCellStyles}>Status</th>
                <th style={headerCellStyles}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id}>
                  <td style={cellStyles}>
                    <div style={{ fontWeight: 600 }}>
                      {position.token0.symbol}/{position.token1.symbol}
                    </div>
                    <div style={{ opacity: 0.6, fontSize: 12 }}>{position.poolId}</div>
                  </td>
                  <td style={cellStyles}>{formatRange(position)}</td>
                  <td style={cellStyles}>{position.liquidity}</td>
                  <td style={cellStyles}>{formatUsdUtil(position.notionalUsd)}</td>
                  <td style={cellStyles}>{formatUsdUtil(position.feesUsd)}</td>
                  <td style={cellStyles}>
                    <span
                      style={{
                        ...styles.badge,
                        display: 'inline-block',
                        fontWeight: 600,
                        color: position.isInRange ? colors.accent.green : colors.accent.orange,
                        backgroundColor: position.isInRange ? colors.accent.greenBg : colors.accent.orangeBg,
                      }}
                    >
                      {position.isInRange ? 'IN RANGE' : 'OUT OF RANGE'}
                    </span>
                  </td>
                  <td style={cellStyles}>{formatTimestamp(position.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
