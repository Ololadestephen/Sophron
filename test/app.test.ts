import { describe, it, expect } from "vitest";
import { createApp } from "../src/server/app.js";
import { MockDataProvider } from "../src/providers/mock/mock-provider.js";
import type { ServerConfig } from "../src/core/config.js";

const config: ServerConfig = {
  hederaNetwork: "hedera:testnet",
  facilitatorUrl: "https://api.testnet.blocky402.com",
  payToAccount: "0.0.1234",
  untrustedPayToAccount: "0.0.999999",
  dataProvider: "mock",
  port: 4021,
  serverBaseUrl: "http://localhost:4021",
  databasePath: ":memory:",
  maxPerRequestTinybar: "5000000",
  dailyLimitTinybar: "6000000",
  approvalAboveTinybar: "2000000",
  reservationTtlSeconds: 900,
  openAiModel: "gpt-4o-mini",
  demoMode: false,
  dashboardOrigin: "http://localhost:4321",
};

const app = createApp(new MockDataProvider(), config, undefined, { enablePaymentMiddleware: false });

describe("resource server pre-validation (offline)", () => {
  it("404 for an unknown product", async () => {
    const res = await app.request("/data/does-not-exist?symbol=AAPL");
    expect(res.status).toBe(404);
  });

  it("400 when a required param is missing", async () => {
    const res = await app.request("/data/risk-report");
    expect(res.status).toBe(400);
  });

  it("serves the catalog without payment", async () => {
    const res = await app.request("/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: unknown[] };
    expect(body.products.length).toBe(2);
  });

  it("restricts browser CORS to the configured dashboard origin", async () => {
    const allowed = await app.request("/health", { headers: { origin: "http://localhost:4321" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:4321");

    const unknown = await app.request("/health", { headers: { origin: "https://attacker.example" } });
    expect(unknown.headers.get("access-control-allow-origin")).toBeNull();
  });
});
