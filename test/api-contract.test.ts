import { describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../src/core/config.js";
import { buildPolicy } from "../src/core/services.js";
import type { PaymentGate } from "../src/payment/gate.js";
import { MockDataProvider } from "../src/providers/mock/mock-provider.js";
import { createApp } from "../src/server/app.js";
import { SqliteStore } from "../src/storage/sqlite-store.js";

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
  demoMode: true,
  dashboardOrigin: "http://localhost:4321",
};

const seedAttempt = (store: SqliteStore, id: string) => {
  store.createAttempt({
    id,
    serviceId: "market-brief",
    serviceName: "Market Brief",
    merchantId: "sophron-demo",
    resourceUrl: "http://localhost:4021/data/market-brief?symbol=HBAR",
    amountTinybar: "3000000",
    challengeHash: `hash-${id}`,
    paymentRequiredHeader: `header-${id}`,
  });
  store.reserveIfWithinBudget(id, "3000000", "6000000", 900);
  return store.transition(id, "pending_approval", {
    policyOutcome: "pending_approval",
    policyReasons: ["approval required"],
  });
};

describe("dashboard API contract", () => {
  it("serves policy, attempts, detail, denial, agent run, and reset shapes", async () => {
    const store = new SqliteStore(":memory:");
    const policy = buildPolicy(config);
    seedAttempt(store, "pending-1");
    const deny = vi.fn((id: string) => {
      store.releaseReservation(id);
      return store.transition(id, "denied", {}, "human_denied");
    });
    const gate = { deny, approve: vi.fn() } as unknown as PaymentGate;
    const agent = {
      run: vi.fn(async () => {
        const attempt = store.createAttempt({
          id: "agent-1",
          serviceId: "risk-report",
          serviceName: "Account Risk Report",
          merchantId: "sophron-demo",
          resourceUrl: "http://localhost:4021/data/risk-report?account=0.0.7",
          amountTinybar: "1000000",
          challengeHash: "hash-agent",
          paymentRequiredHeader: "header-agent",
        });
        return { message: "evaluated", attemptId: attempt.id };
      }),
    };
    const app = createApp(
      new MockDataProvider(),
      config,
      { store, policy, gate, agent },
      { enablePaymentMiddleware: false },
    );

    const policyResponse = await app.request("/api/policy");
    expect(policyResponse.status).toBe(200);
    expect(await policyResponse.json()).toMatchObject({
      policy: { currency: "HBAR", reservationTtlSeconds: 900 },
      spend: { reservedTinybar: "3000000" },
    });

    const attemptsResponse = await app.request("/api/attempts");
    expect((await attemptsResponse.json()) as { attempts: unknown[] }).toMatchObject({ attempts: [{ id: "pending-1" }] });

    const detailResponse = await app.request("/api/attempts/pending-1");
    expect(await detailResponse.json()).toMatchObject({
      attempt: { id: "pending-1", status: "pending_approval" },
      events: expect.any(Array),
    });

    const denyResponse = await app.request("/api/attempts/pending-1/deny", { method: "POST" });
    expect(await denyResponse.json()).toMatchObject({ attempt: { status: "denied" } });
    expect(deny).toHaveBeenCalledWith("pending-1");

    const agentResponse = await app.request("/api/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "buy risk", serviceId: "risk-report" }),
    });
    expect(await agentResponse.json()).toMatchObject({ message: "evaluated", attempt: { id: "agent-1" } });

    const resetResponse = await app.request("/api/demo/reset", { method: "POST" });
    expect(await resetResponse.json()).toMatchObject({ ok: true, policy: { spend: { reservedTinybar: "0" } } });
    expect(store.listAttempts()).toHaveLength(0);
    store.close();
  });

  it("does not expose destructive demo reset unless demo mode is explicit", async () => {
    const store = new SqliteStore(":memory:");
    const policy = buildPolicy({ ...config, demoMode: false });
    seedAttempt(store, "kept-1");
    const gate = { deny: vi.fn(), approve: vi.fn() } as unknown as PaymentGate;
    const agent = { run: vi.fn() };
    const app = createApp(
      new MockDataProvider(),
      { ...config, demoMode: false },
      { store, policy, gate, agent },
      { enablePaymentMiddleware: false },
    );

    const response = await app.request("/api/demo/reset", { method: "POST" });
    expect(response.status).toBe(403);
    expect(store.listAttempts()).toHaveLength(1);
    store.close();
  });
});
