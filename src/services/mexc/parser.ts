type VarintResult = { value: bigint; nextOffset: number };

function readVarint(buffer: Buffer, offset: number): VarintResult {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    result |= BigInt(byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7n;
  }

  return { value: result, nextOffset: cursor };
}

function readLengthDelimited(buffer: Buffer, offset: number) {
  const { value, nextOffset } = readVarint(buffer, offset);
  const length = Number(value);
  const start = nextOffset;
  const end = start + length;
  return {
    payload: buffer.subarray(start, end),
    nextOffset: end,
  };
}

function readString(buffer: Buffer): string {
  return buffer.toString("utf8");
}

function safeNumber(value: string | bigint): number {
  if (typeof value === "bigint") {
    const num = Number(value);
    if (!Number.isFinite(num)) return Number.MAX_SAFE_INTEGER;
    return num;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function decodeAggreBookTicker(buffer: Buffer) {
  let bidPrice = "";
  let bidQuantity = "";
  let askPrice = "";
  let askQuantity = "";

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType !== 2) {
      break;
    }

    const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
    offset = afterPayload;
    const text = readString(payload);

    if (fieldNumber === 1) bidPrice = text;
    else if (fieldNumber === 2) bidQuantity = text;
    else if (fieldNumber === 3) askPrice = text;
    else if (fieldNumber === 4) askQuantity = text;
  }

  return { bidPrice, bidQuantity, askPrice, askQuantity };
}

type DepthLevel = {
  price: string;
  quantity: string;
};

function decodeAggreDepthLevel(buffer: Buffer): DepthLevel {
  let price = "";
  let quantity = "";

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (wireType !== 2) {
      break;
    }
    const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
    offset = afterPayload;
    const text = readString(payload);

    if (fieldNumber === 1) price = text;
    else if (fieldNumber === 2) quantity = text;
  }

  return { price, quantity };
}

function decodeAggreDepth(buffer: Buffer) {
  const asks: DepthLevel[] = [];
  const bids: DepthLevel[] = [];
  let eventType: string | undefined;
  let fromVersion: string | undefined;
  let toVersion: string | undefined;

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType === 2) {
      const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
      offset = afterPayload;

      if (fieldNumber === 1) asks.push(decodeAggreDepthLevel(payload));
      else if (fieldNumber === 2) bids.push(decodeAggreDepthLevel(payload));
      else if (fieldNumber === 3) eventType = readString(payload);
      else if (fieldNumber === 4) fromVersion = readString(payload);
      else if (fieldNumber === 5) toVersion = readString(payload);
    } else {
      break;
    }
  }

  return { asks, bids, eventType, fromVersion, toVersion };
}

type DealItem = {
  price: string;
  quantity: string;
  tradeType: number;
  time: number;
};

function decodeAggreDeal(buffer: Buffer): DealItem {
  let price = "";
  let quantity = "";
  let tradeType = 0;
  let time = 0;

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType === 2) {
      const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
      offset = afterPayload;
      const text = readString(payload);
      if (fieldNumber === 1) price = text;
      else if (fieldNumber === 2) quantity = text;
    } else if (wireType === 0) {
      const { value, nextOffset: afterVarint } = readVarint(buffer, offset);
      offset = afterVarint;
      if (fieldNumber === 3) tradeType = safeNumber(value);
      else if (fieldNumber === 4) time = safeNumber(value);
    } else {
      break;
    }
  }

  return { price, quantity, tradeType, time };
}

function decodeAggreDeals(buffer: Buffer) {
  const deals: DealItem[] = [];
  let eventType: string | undefined;

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType === 2) {
      const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
      offset = afterPayload;
      if (fieldNumber === 1) deals.push(decodeAggreDeal(payload));
      else if (fieldNumber === 2) eventType = readString(payload);
    } else {
      break;
    }
  }

  return { deals, eventType };
}

export type MexcPushMessage =
  | {
      type: "bookTicker";
      channel: string;
      symbol?: string;
      ts: number;
      bidPrice: string;
      bidQuantity: string;
      askPrice: string;
      askQuantity: string;
    }
  | {
      type: "depth";
      channel: string;
      symbol?: string;
      ts: number;
      asks: DepthLevel[];
      bids: DepthLevel[];
      fromVersion?: string;
      toVersion?: string;
    }
  | {
      type: "deals";
      channel: string;
      symbol?: string;
      ts: number;
      deals: DealItem[];
    };

export function decodeMexcPush(buffer: Buffer): MexcPushMessage | undefined {
  let channel = "";
  let symbol: string | undefined;
  let createTime: number | undefined;
  let sendTime: number | undefined;
  let bodyType: 313 | 314 | 315 | undefined;
  let body: Buffer | undefined;

  let offset = 0;
  while (offset < buffer.length) {
    const { value: tag, nextOffset } = readVarint(buffer, offset);
    offset = nextOffset;
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType === 2) {
      const { payload, nextOffset: afterPayload } = readLengthDelimited(buffer, offset);
      offset = afterPayload;

      if (fieldNumber === 1) {
        channel = readString(payload);
      } else if (fieldNumber === 3) {
        symbol = readString(payload);
      } else if (fieldNumber === 313 || fieldNumber === 314 || fieldNumber === 315) {
        bodyType = fieldNumber as 313 | 314 | 315;
        body = payload;
      }
    } else if (wireType === 0) {
      const { value, nextOffset: afterVarint } = readVarint(buffer, offset);
      offset = afterVarint;
      const numeric = safeNumber(value);
      if (fieldNumber === 5) createTime = numeric;
      else if (fieldNumber === 6) sendTime = numeric;
    } else {
      break;
    }
  }

  if (!bodyType || !body) {
    return undefined;
  }

  const ts = sendTime ?? createTime ?? Date.now();

  if (bodyType === 315) {
    const data = decodeAggreBookTicker(body);
    return {
      type: "bookTicker",
      channel,
      symbol,
      ts,
      bidPrice: data.bidPrice,
      bidQuantity: data.bidQuantity,
      askPrice: data.askPrice,
      askQuantity: data.askQuantity,
    };
  }

  if (bodyType === 313) {
    const data = decodeAggreDepth(body);
    return {
      type: "depth",
      channel,
      symbol,
      ts,
      asks: data.asks,
      bids: data.bids,
      fromVersion: data.fromVersion,
      toVersion: data.toVersion,
    };
  }

  if (bodyType === 314) {
    const data = decodeAggreDeals(body);
    return {
      type: "deals",
      channel,
      symbol,
      ts,
      deals: data.deals,
    };
  }

  return undefined;
}
