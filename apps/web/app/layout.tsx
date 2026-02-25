import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';

export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Zephyr Bridge Engine',
  description: 'Arbitrage and liquidity management dashboard for the Zephyr Protocol.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', background: '#0b0f14', color: '#d1e4ff', margin: 0 }}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
