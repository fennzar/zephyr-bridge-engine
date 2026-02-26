import { createLogger } from "@shared/logger";

const log = createLogger("BridgeAPI");

export interface BridgeClaim {
  id: string;
  status: "pending" | "queued" | "ready" | "claimable" | "claimed" | "expired";
  asset: string;
  amount: string;
  evmAddress: string;
  createdAt?: string;
  /** Token contract address (e.g. wZEPH) */
  token: string;
  /** Recipient EVM address */
  to: string;
  /** Amount in wei (atomic units) */
  amountWei: string;
  /** Zephyr transaction hash */
  zephTxId: string;
  /** Claim deadline (unix timestamp) */
  deadline: number;
  /** EIP-712 signature from bridge signer */
  signature: string;
}

export class BridgeApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:7051") {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
  }

  /** Health check */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Get pending/claimable claims for an EVM address */
  async getClaims(evmAddress: string): Promise<BridgeClaim[]> {
    const res = await fetch(`${this.baseUrl}/claims/${evmAddress}`);
    if (!res.ok) {
      throw new Error(`Failed to get claims: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    // API may return { claims: [...] } or just [...]
    return Array.isArray(data) ? data : (data.claims ?? []);
  }

  /** Create a bridge wrap account for an EVM address. Returns the Zephyr subaddress. */
  async createBridgeAccount(evmAddress: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/bridge/address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evmAddress }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create bridge account: ${res.status} ${text}`);
    }
    const data = await res.json() as { zephyrAddress: string };
    return data.zephyrAddress;
  }

  /** Trigger bridge-api pool scan (admin endpoint). */
  async scanPools(adminToken?: string): Promise<{ pools: unknown[] }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminToken) {
      headers["x-admin-token"] = adminToken;
    }
    const res = await fetch(`${this.baseUrl}/admin/uniswap/v4/scan`, {
      method: "POST",
      headers,
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Pool scan failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<{ pools: unknown[] }>;
  }

  /**
   * Prepare an unwrap operation — pre-signs the Zephyr transfer on the bridge side.
   * Returns payload + nonce for calling burnWithData() on the token contract.
   */
  async prepareUnwrap(params: {
    token: string;
    amountWei: string;
    destination: string;
  }): Promise<{
    payload: string;
    txHash: string;
    draftId: string;
    prepareId: string;
    feeWei: string;
    netWei: string;
  }> {
    const res = await fetch(`${this.baseUrl}/unwraps/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Unwrap prepare failed: ${res.status} ${text}`);
    }
    const data = await res.json() as Record<string, unknown>;
    if (!data.ok) {
      throw new Error(`Unwrap prepare rejected: ${JSON.stringify(data)}`);
    }
    return {
      payload: data.payload as string,
      txHash: data.txHash as string,
      draftId: data.draftId as string,
      prepareId: data.prepareId as string,
      feeWei: data.feeWei as string,
      netWei: data.netWei as string,
    };
  }

  /** Get unwrap status by ID (evmTxHash:logIndex) */
  async getUnwrapStatus(id: string): Promise<{ status: string; zephConfirmations?: number }> {
    const res = await fetch(`${this.baseUrl}/unwraps/id/${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`Get unwrap status failed: ${res.status}`);
    }
    return res.json() as Promise<{ status: string; zephConfirmations?: number }>;
  }

  /** Poll until expected number of claimable claims appear, or timeout */
  async waitForClaims(
    evmAddress: string,
    expectedCount: number,
    timeoutMs: number = 300_000,
  ): Promise<BridgeClaim[]> {
    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 3_000;

    log.info(`Waiting for ${expectedCount} claimable claims for ${evmAddress}...`);

    while (Date.now() < deadline) {
      try {
        const claims = await this.getClaims(evmAddress);
        const claimable = claims.filter(c => c.status === "claimable");

        if (claimable.length >= expectedCount) {
          log.info(`Found ${claimable.length}/${expectedCount} claimable claims`);
          return claimable;
        }

        log.info(`Waiting... ${claimable.length}/${expectedCount} claimable so far`);
      } catch (err) {
        log.warn(`Poll error: ${err instanceof Error ? err.message : err}`);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `Timed out waiting for ${expectedCount} claimable claims after ${timeoutMs}ms`
    );
  }
}
