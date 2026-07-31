import type { DataProvider, DataProduct, DataResult } from "../../core/provider.js";
import { generateData, MOCK_WINDOW_SEC } from "./generator.js";

const CATALOG: DataProduct[] = [
  {
    id: "risk-report",
    description: "Compact deterministic account risk report",
    asset: "0.0.0",
    priceAtomic: "1000000",
    paramsSchema: { account: { type: "string", required: true } },
  },
  {
    id: "market-brief",
    description: "Premium deterministic market brief",
    asset: "0.0.0",
    priceAtomic: "3000000",
    paramsSchema: { symbol: { type: "string", required: true } },
  },
];

export class MockDataProvider implements DataProvider {
  readonly id = "mock";

  catalog(): DataProduct[] {
    return CATALOG;
  }

  async fetch(productId: string, params: Record<string, string>): Promise<DataResult> {
    const product = CATALOG.find((p) => p.id === productId);
    if (!product) throw new Error(`Unknown product: ${productId}`);

    const subject = params.symbol ?? params.account ?? "";
    const windowSeed = Math.floor(Date.now() / 1000 / MOCK_WINDOW_SEC);
    const data = generateData({ productId, symbol: subject, date: params.date, windowSeed });

    return { data, asOf: new Date().toISOString(), providerId: this.id };
  }
}
