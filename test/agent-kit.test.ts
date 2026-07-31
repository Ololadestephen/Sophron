import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttemptContract } from "../src/core/contracts.js";
import { SophronAgent } from "../src/agent/sophron-agent.js";
import type { PaymentGate } from "../src/payment/gate.js";

const attempt: AttemptContract = {
  id: "attempt-hak-1",
  serviceId: "risk-report",
  serviceName: "Account Risk Report",
  merchantId: "sophron-demo",
  resourceUrl: "http://localhost:4021/data/risk-report?account=0.0.1234",
  amountTinybar: "1000000",
  currency: "HBAR",
  status: "fulfilled",
  policyOutcome: "approved",
  policyReasons: ["passed"],
  challengeHash: "abc",
  reservationExpiresAt: null,
  transactionId: "0.0.1@1.1",
  hashscanUrl: "https://hashscan.io/testnet/transaction/example",
  responsePreview: { score: 21 },
  error: null,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:01.000Z",
};

afterEach(() => vi.unstubAllEnvs());

describe("Sophron Hedera Agent Kit v4 integration", () => {
  it("executes the constrained purchase_service BaseTool without exposing a model key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const purchase = vi.fn().mockResolvedValue(attempt);
    const gate = { purchase } as unknown as PaymentGate;
    const agent = new SophronAgent(gate, "gpt-4o-mini");
    const result = await agent.run({
      prompt: "Buy an account risk report",
      serviceId: "risk-report",
      params: { account: "0.0.1234" },
    });
    expect(result.attemptId).toBe(attempt.id);
    expect(purchase).toHaveBeenCalledWith({
      serviceId: "risk-report",
      params: { account: "0.0.1234" },
    });
    expect(result.message).toMatch(/Agent Kit/i);
  });
});
