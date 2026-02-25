import { env } from '@shared';

const HEADERS: HeadersInit = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function getDaemonUrl(): string {
  return env.ZEPHYR_D_RPC_URL;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const rpcUrl = getDaemonUrl();
  const url = `${rpcUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zephyrd RPC ${path} failed: ${response.status} ${text}`);
  }
  return response.json() as Promise<T>;
}

export type GetHeightResponse = {
  hash: string;
  height: number;
  status: string;
  untrusted: boolean;
};

export type ReservePriceReport = {
  moving_average: number;
  reserve: number;
  reserve_ma: number;
  reserve_ratio: number;
  reserve_ratio_ma: number;
  signature: string;
  spot: number;
  stable: number;
  stable_ma: number;
  timestamp: number;
  yield_price: number;
};

export type ReserveInfoResult = {
  assets: string;
  assets_ma: string;
  equity: string;
  equity_ma: string;
  height: number;
  hf_version: number;
  liabilities: string;
  num_reserves: string;
  num_stables: string;
  num_zyield: string;
  pr: ReservePriceReport;
  reserve_ratio: string;
  reserve_ratio_ma: string;
  status: string;
  zeph_reserve: string;
  zyield_reserve: string;
};

export type ReserveInfoResponse = {
  id: string;
  jsonrpc: string;
  result: ReserveInfoResult;
};

export async function getHeight(): Promise<GetHeightResponse> {
  return postJson<GetHeightResponse>('/get_height');
}

export async function getReserveInfo(): Promise<ReserveInfoResult> {
  const payload = {
    jsonrpc: '2.0',
    id: '0',
    method: 'get_reserve_info',
  };
  const response = await postJson<ReserveInfoResponse>('/json_rpc', payload);
  return response.result;
}
