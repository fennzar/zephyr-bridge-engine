import { mexc } from '@services';

type MexcPaperType = InstanceType<typeof mexc.MexcPaper>;

type GlobalState = typeof globalThis & {
  __mexcPaper?: MexcPaperType;
};

function getGlobal(): GlobalState {
  return globalThis as GlobalState;
}

export function getPaperStore(): MexcPaperType {
  const globalRef = getGlobal();
  if (!globalRef.__mexcPaper) {
    globalRef.__mexcPaper = new mexc.MexcPaper({
      USDT: 100_000,
      ZEPH: 2_500,
      ZSD: 10_000,
    });
  }
  return globalRef.__mexcPaper;
}
