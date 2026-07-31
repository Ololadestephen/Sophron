import { describe, expect, it } from "vitest";
import type { PolicyContract } from "../src/core/contracts.js";
import { evaluatePolicy, tinybarToHbar } from "../src/policy/engine.js";

const policy: PolicyContract = {
  currency: "HBAR",
  maxPerRequestTinybar: "5000000",
  dailyLimitTinybar: "6000000",
  approvalAboveTinybar: "2000000",
  reservationTtlSeconds: 900,
  allowedMerchants: [
    {
      id: "sophron-demo",
      name: "Sophron Demo Services",
      payToAccountId: "0.0.1234",
      origins: ["http://localhost:4021"],
    },
  ],
};

const intent = {
  merchantId: "sophron-demo",
  origin: "http://localhost:4021",
  payToAccountId: "0.0.1234",
  amountTinybar: "1000000",
  asset: "0.0.0",
  network: "hedera:testnet",
};

describe("evaluatePolicy", () => {
  it("automatically approves an allowlisted request at the approval boundary", () => {
    expect(
      evaluatePolicy(policy, { ...intent, amountTinybar: "2000000" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("approved");
  });

  it("requires approval one tinybar above the boundary", () => {
    expect(
      evaluatePolicy(policy, { ...intent, amountTinybar: "2000001" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("pending_approval");
  });

  it("rejects an unknown merchant", () => {
    expect(
      evaluatePolicy(policy, { ...intent, merchantId: "unknown" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("rejected");
  });

  it("rejects a destination mismatch", () => {
    expect(
      evaluatePolicy(policy, { ...intent, payToAccountId: "0.0.9999" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("rejected");
  });

  it("rejects one tinybar over the request maximum", () => {
    expect(
      evaluatePolicy(policy, { ...intent, amountTinybar: "5000001" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("rejected");
  });

  it("allows exactly the per-request maximum", () => {
    expect(
      evaluatePolicy(policy, { ...intent, amountTinybar: "5000000" }, { settledTinybar: "0", reservedTinybar: "0" }).outcome,
    ).toBe("pending_approval");
  });

  it("allows a purchase that exactly consumes the remaining daily budget", () => {
    expect(
      evaluatePolicy(policy, intent, { settledTinybar: "5000000", reservedTinybar: "0" }).outcome,
    ).toBe("approved");
  });

  it("counts active reservations against the UTC-day budget", () => {
    expect(
      evaluatePolicy(policy, intent, { settledTinybar: "4000000", reservedTinybar: "1000001" }).outcome,
    ).toBe("rejected");
  });

  it("rejects malformed amounts", () => {
    expect(() =>
      evaluatePolicy(policy, { ...intent, amountTinybar: "1.5" }, { settledTinybar: "0", reservedTinybar: "0" }),
    ).toThrow(/integer string/);
    expect(() =>
      evaluatePolicy(policy, { ...intent, amountTinybar: "-1" }, { settledTinybar: "0", reservedTinybar: "0" }),
    ).toThrow(/integer string/);
  });
});

describe("tinybarToHbar", () => {
  it("formats tinybar without floating point arithmetic", () => {
    expect(tinybarToHbar("1000000")).toBe("0.01");
    expect(tinybarToHbar("100000000")).toBe("1");
  });
});
