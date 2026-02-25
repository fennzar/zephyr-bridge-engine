# Services

The services layer (`src/services/`) provides external integrations. Each service supports both live and simulated modes.

## EVM Service (`src/services/evm/`)

### Client Setup

Uses viem for all EVM interactions. `viemClient.ts` creates public and wallet clients:

- **local**: Anvil chain (id 31337) at `http://127.0.0.1:8545`
- **sepolia**: Sepolia testnet
- **mainnet**: Ethereum mainnet

Network is inferred from `ZEPHYR_ENV`.

### EvmExecutor

Created by `createEvmExecutor(privateKey?)`. Requires `EVM_PRIVATE_KEY` from env if not provided.

**Swap operations:**

| Method | Description |
|--------|-------------|
| `executeSwap(params)` | Swap on Uniswap V4 via SwapRouter. Auto-approves tokens. Returns `{success, txHash, amountOut, gasUsed}` |

**Bridge operations:**

| Method | Description |
|--------|-------------|
| `unwrapToNative(params)` | Burns wrapped tokens on EVM to initiate unwrap to Zephyr native |
| `claimWrapped(params)` | Claims wrapped tokens from a bridge voucher |
| `claimWithSignature(params)` | Claims via EIP-712 signature on the token contract |

**LP operations:**

| Method | Description |
|--------|-------------|
| `executeLpMint(params)` | Adds liquidity. Uses V4 PositionManager actions MINT_POSITION + SETTLE_PAIR. Approves via Permit2 |
| `executeLpBurn(params)` | Removes liquidity. Uses DECREASE_LIQUIDITY + TAKE_PAIR |
| `executeLpCollect(params)` | Collects fees without changing position (decrease liquidity by 0) |

**Balance queries:**

| Method | Description |
|--------|-------------|
| `getEthBalance()` | Native ETH balance |
| `getTokenBalance(asset)` | ERC-20 balanceOf for any tracked token |

### Token Approval

`approval.ts` handles the two-step Uniswap V4 approval pattern:

1. ERC-20 `approve` token to Permit2 (max allowance)
2. Permit2 `approve` token to spender (30-day expiration)

### Uniswap V4 Subsystem

| Module | Purpose |
|--------|---------|
| `uniswapV4/quoter.ts` | On-chain quote via `v4Quoter.quoteExactInputSingle()` |
| `uniswapV4/discovery.ts` | Pool discovery from on-chain events |
| `uniswapV4/watcher.ts` | WebSocket-based swap event listener |
| `uniswapV4/persistence.ts` | Pool state and swap event DB persistence |
| `uniswapV4/liquidityMath.ts` | Tick math, liquidity calculations |
| `uniswapV4/backfill.ts` | Historical event backfill from RPC |

### Address Configuration

`config/index.ts` loads network-specific JSON files (`addresses.{local|sepolia|mainnet}.json`) containing contract addresses, token definitions, and pool configurations. See [Configuration](configuration.md#address-configuration).

---

## MEXC Service (`src/services/mexc/`)

### IMexcClient Interface

All CEX operations go through this interface:

```typescript
interface IMexcClient {
  readonly mode: ExecutionMode;
  getBalances(): Promise<MexcBalances>;
  getBalance(asset: string): Promise<MexcBalance | null>;
  marketOrder(params: MexcMarketOrderParams): Promise<MexcOrderResult>;
  getDepositAddress(asset: string, network?: string): Promise<MexcDepositAddress>;
  requestWithdraw(params: MexcWithdrawParams): Promise<MexcWithdrawResult>;
  getRecentEvents(limit?: number): Promise<MexcEvent[]>;
  notifyDeposit(asset: string, amount: number): Promise<void>;
}
```

### Live Implementation

`MexcLiveClient` in `live.ts` uses `MexcRest` to call the real MEXC API:

- HMAC-SHA256 request signing
- `GET /api/v3/account` for balances
- `POST /api/v3/order` with `type: "MARKET"` for trades
- Calculates executed price from `cummulativeQuoteQty / executedQty`
- Sums fees from the fills array

### Paper Implementation

`MexcPaperClient` in `paper.ts` simulates trades in memory:

- Initial balances: `{ USDT: 100_000, ZEPH: 0 }`
- Default fee: 10 bps (0.10%)
- Withdrawal fees: ZEPH 0.1, USDT 1.0
- Gets prices from the fake orderbook (or real MEXC depth)
- Mock deposit addresses for testing

### Factory

```typescript
createMexcClient(mode)
```

- `mode === "live"` and `!MEXC_PAPER` -> `MexcLiveClient` (real API)
- Otherwise -> `CexWalletClient` (accounting-only with real wallet backends)

### Market Data

`market.ts` provides order book data via `getMexcDepth()`:

- Uses `FAKE_ORDERBOOK_ENABLED` env to switch between fake orderbook (port 5556) and real MEXC
- Returns `MexcDepthSummary` with best bid/ask, spread in bps, mid price, and USD depth

---

## Zephyr Service (`src/services/zephyr/`)

### Daemon RPC

`zephyrd.ts` talks to the Zephyr daemon at `ZEPHYR_D_RPC_URL`:

| Method | RPC Call | Returns |
|--------|----------|---------|
| `getHeight()` | `get_height` | Current block height |
| `getReserveInfo()` | `get_reserve_info` | Full reserve state: RR, spot/MA prices, supply, policy |

### Wallet RPC

`ZephyrWalletClient` in `wallet.ts` uses `ZEPHYR_WALLET_RPC_URL`:

**Balance and status:**

| Method | Description |
|--------|-------------|
| `getBalance()` | All asset balances (total + unlocked) for ZEPH, ZSD, ZRS, ZYS |
| `getAddress()` | Wallet's primary address |
| `isReady()` | Health check (attempts `get_height`) |

**Conversion operations (6 total):**

| Method | Description |
|--------|-------------|
| `mintStable(amount)` | ZEPH -> ZSD |
| `redeemStable(amount)` | ZSD -> ZEPH |
| `mintReserve(amount)` | ZEPH -> ZRS |
| `redeemReserve(amount)` | ZRS -> ZEPH |
| `mintYield(amount)` | ZSD -> ZYS |
| `redeemYield(amount)` | ZYS -> ZSD |

**Other operations:**

| Method | Description |
|--------|-------------|
| `transfer(params)` | Send any Zephyr asset to an address |
| `getPricing(type, amount)` | Preview conversion rate without executing |
| `wrapToEvm(asset, amount, evmAddr)` | Send to bridge address with EVM address as payment ID |

All amounts are in atomic units (multiply by 1e12). The wallet RPC maps asset types to v2 names: `{ ZEPH: "ZPH", ZSD: "ZSD", ZRS: "ZRS", ZYS: "ZYS" }`.

---

## Bridge Service (`src/services/bridge/`)

### BridgeExecutor

Created by `createBridgeExecutor(zephyrWallet, evmExecutor)`. Coordinates cross-chain transfers.

**Wrap flow (Native -> EVM):**

1. `zephyrWallet.wrapToEvm(asset, amount, evmAddress)` sends native tokens to the bridge address
2. Bridge server detects the deposit and creates a claimable voucher
3. `claimWrapped(voucherId)` or `claimWithSignature()` mints wrapped tokens on EVM

**Unwrap flow (EVM -> Native):**

1. `evmExecutor.unwrapToNative(asset, amount, nativeAddress)` burns wrapped tokens on EVM
2. Bridge detects the burn event and credits native tokens to the Zephyr address
3. Tokens are locked for ~10 blocks (~20 minutes) before becoming spendable

**Asset mapping:**

| Native | Wrapped |
|--------|---------|
| ZEPH | WZEPH.e |
| ZSD | WZSD.e |
| ZRS | WZRS.e |
| ZYS | WZYS.e |

### BridgeApiClient

REST client at `BRIDGE_API_URL` (default `http://localhost:5557`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `isHealthy()` | `GET /health` | Health check |
| `getClaims(evmAddr)` | `GET /claims/{addr}` | List bridge claims for an address |
| `createBridgeAccount(evmAddr)` | `POST /bridge/address` | Create Zephyr address linked to EVM address |
| `waitForClaims(addr, count, timeout)` | Polls `/claims` | Wait for N claimable claims (3s poll interval, 5min default timeout) |

Each claim carries an EIP-712 signature for gasless claiming: `{token, to, amountWei, zephTxId, deadline, signature}`.

---

## CEX Wallet Service (`src/services/cex/`)

`CexWalletClient` backs the simulated exchange with real wallets, providing accounting-only trades while holding actual assets.

### Architecture

Two backends handle different assets:

| Asset | Backend | Source |
|-------|---------|--------|
| ZEPH | `cex/rpc.ts` | Dedicated Zephyr wallet at `CEX_WALLET_RPC_URL` |
| USDT | `cex/evm.ts` | ERC-20 balance at `CEX_ADDRESS` on EVM |

### Operations

| Method | Behavior |
|--------|----------|
| `getBalances()` | Reads ZEPH from Zephyr wallet, USDT from EVM token balance |
| `marketOrder(params)` | Accounting-only trade using fake orderbook price. 0.10% fee. No actual fund movement |
| `getDepositAddress(asset)` | ZEPH: Zephyr wallet address. USDT: EVM address |
| `requestWithdraw(params)` | ZEPH: `transfer()` via Zephyr wallet RPC. USDT: ERC-20 `transfer()` on EVM |

### Mode selection

`getCexWalletClient(mode)` returns a singleton `CexWalletClient`. Used for both paper and devnet modes. In live mode, `createMexcClient()` returns a `MexcLiveClient` instead (unless `MEXC_PAPER=true`).

---

## Mode Summary

| Service | Live | Paper/Devnet |
|---------|------|-------------|
| **EVM** | viem clients against production RPC | Same clients against local Anvil |
| **MEXC** | `MexcLiveClient` (real MEXC REST API) | `CexWalletClient` (real wallets, accounting-only trades) |
| **Zephyr** | Wallet RPC against mainnet daemon | Same RPC against local devnet daemon |
| **Bridge** | Real bridge with production contracts | Same bridge against local infrastructure |
| **CEX Wallet** | Not used (replaced by `MexcLiveClient`) | Real ZEPH wallet + real USDT token, simulated order matching |
