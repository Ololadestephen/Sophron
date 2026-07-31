export const MOCK_WINDOW_SEC = 60;

export interface GenerateInput {
  productId: string;
  symbol: string;
  date?: string;
  windowSeed: number;
}

const hashSeed = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const generateData = ({ productId, symbol, date, windowSeed }: GenerateInput): unknown => {
  const rand = mulberry32(hashSeed(`${productId}:${symbol}:${date ?? ""}:${windowSeed}`));
  const base = 50 + rand() * 450;
  switch (productId) {
    case "risk-report": {
      const score = Math.floor(20 + rand() * 70);
      return {
        account: symbol,
        score,
        rating: score < 40 ? "low" : score < 70 ? "moderate" : "elevated",
        signals: [
          { name: "transaction_velocity", value: round2(rand() * 100) },
          { name: "counterparty_concentration", value: round2(rand() * 100) },
          { name: "account_age", value: round2(rand() * 100) },
        ],
        disclaimer: "Deterministic demo data; not financial or security advice.",
      };
    }
    case "market-brief":
      return {
        symbol,
        referencePrice: round2(base),
        direction: rand() > 0.5 ? "constructive" : "cautious",
        volatility: round2(10 + rand() * 70),
        summary: `Deterministic demo brief for ${symbol}; generated for the Sophron approval flow.`,
        disclaimer: "Deterministic demo data; not financial advice.",
      };
    default:
      throw new Error(`Unknown product: ${productId}`);
  }
};
