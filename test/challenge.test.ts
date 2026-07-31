import { describe, expect, it } from "vitest";
import { hashReceipt } from "../src/payment/challenge.js";

describe("receipt hashing", () => {
  it("is deterministic for the canonical receipt fields", () => {
    const receipt = {
      attemptId: "attempt-1",
      challengeHash: "abc123",
      transactionId: "0.0.7@1784990000.000000001",
      network: "hedera:testnet",
      payer: "0.0.8",
      amountTinybar: "1000000",
      merchantId: "sophron-demo",
      resourceUrl: "http://localhost:4021/data/risk-report?account=0.0.7",
    };

    expect(hashReceipt(receipt)).toBe(hashReceipt({ ...receipt }));
    expect(hashReceipt(receipt)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashReceipt({ ...receipt, amountTinybar: "1000001" })).not.toBe(hashReceipt(receipt));
  });
});
