import { evm } from "@services";
import {
  WZephLogo,
  WZsdLogo,
  WZrsLogo,
  WZysLogo,
  EthLogo,
  UsdcLogo,
  UsdtLogo,
  type SvgProps,
} from "@/components/LogoSvgs";
import { formatAddress } from "../_lib/dashboard-format";

export type TokenCardProps = {
  token: ReturnType<typeof evm.getTrackedTokens>[number];
};

export function TokenCard({ token }: TokenCardProps) {
  const upperSymbol = token.symbol.toUpperCase();
  let Logo: React.FC<SvgProps> | null = null;

  switch (upperSymbol) {
    case "WZEPH":
      Logo = WZephLogo;
      break;
    case "WZSD":
      Logo = WZsdLogo;
      break;
    case "WZRS":
      Logo = WZrsLogo;
      break;
    case "WZYS":
      Logo = WZysLogo;
      break;
    case "USDC":
      Logo = UsdcLogo;
      break;
    case "USDT":
      Logo = UsdtLogo;
      break;
    default:
      Logo = EthLogo;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: 12,
        padding: "10px 12px",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        background: "#121a24",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 42,
        }}
      >
        {Logo && <Logo size={42} />}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontWeight: 600 }}>{token.symbol}</div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>{token.name}</div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          <span style={{ fontFamily: "ui-monospace" }}>
            {formatAddress(token.address)}
          </span>
          <span>Decimals: {token.decimals}</span>
        </div>
      </div>
    </div>
  );
}
