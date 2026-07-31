import { describe, expect, it } from "vitest";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import type { PolicyContract } from "../src/core/contracts.js";
import { PaymentGate } from "../src/payment/gate.js";
import type { PaymentSigner } from "../src/payment/signer.js";
import { SqliteStore } from "../src/storage/sqlite-store.js";

class SignerSpy implements PaymentSigner {
  calls: string[] = [];

  async signPaymentRequired(header: string): Promise<string> {
    this.calls.push(header);
    return "signed-payment";
  }
}

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

const challengeFor = (url: string, payToOverride?: string): string => {
  const untrusted = url.includes("/untrusted/");
  const premium = url.includes("market-brief");
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url, description: "Sophron test resource", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "hedera:testnet",
        asset: "0.0.0",
        amount: untrusted ? "500000" : premium ? "3000000" : "1000000",
        payTo: payToOverride ?? (untrusted ? "0.0.999999" : "0.0.1234"),
        maxTimeoutSeconds: 180,
        extra: { feePayer: "0.0.7162784" },
      },
    ],
  };
  return encodePaymentRequiredHeader(paymentRequired);
};

const paidHeader = (): string => {
  const settlement: SettleResponse = {
    success: true,
    transaction: "0.0.7162784@1784990000.000000001",
    network: "hedera:testnet",
    payer: "0.0.4321",
  };
  return encodePaymentResponseHeader(settlement);
};

const fakeFetch: typeof fetch = async (input, init) => {
  const url = input.toString();
  const headers = new Headers(init?.headers);
  if (headers.has("payment-signature")) {
    return new Response(JSON.stringify({ ok: true, resource: url }), {
      status: 200,
      headers: { "content-type": "application/json", "payment-response": paidHeader() },
    });
  }
  return new Response(JSON.stringify({ error: "Payment required" }), {
    status: 402,
    headers: { "content-type": "application/json", "payment-required": challengeFor(url) },
  });
};

const setup = () => {
  const store = new SqliteStore(":memory:");
  const signer = new SignerSpy();
  const gate = new PaymentGate({
    policy,
    store,
    signer,
    serverBaseUrl: "http://localhost:4021",
    fetchImpl: fakeFetch,
  });
  return { store, signer, gate };
};

describe("PaymentGate", () => {
  it("auto-pays an allowlisted request below the approval threshold", async () => {
    const { store, signer, gate } = setup();
    const attempt = await gate.purchase({ serviceId: "risk-report", params: { account: "0.0.7" } });
    expect(attempt.status).toBe("fulfilled");
    expect(attempt.transactionId).toContain("@");
    expect(signer.calls).toHaveLength(1);
    expect(store.getEvents(attempt.id).map((event) => event.toStatus)).toContain("settled");
    store.close();
  });

  it("pauses a premium request and signs only after human approval", async () => {
    const { store, signer, gate } = setup();
    const pending = await gate.purchase({ serviceId: "market-brief", params: { symbol: "HBAR" } });
    expect(pending.status).toBe("pending_approval");
    expect(signer.calls).toHaveLength(0);
    const fulfilled = await gate.approve(pending.id);
    expect(fulfilled.status).toBe("fulfilled");
    expect(signer.calls).toHaveLength(1);
    store.close();
  });

  it("rejects an unknown merchant before calling the signer", async () => {
    const { store, signer, gate } = setup();
    const attempt = await gate.purchase({ serviceId: "unknown-provider" });
    expect(attempt.status).toBe("rejected");
    expect(attempt.policyReasons.join(" ")).toMatch(/not allowlisted/);
    expect(signer.calls).toHaveLength(0);
    store.close();
  });

  it("releases a reservation when a human denies an attempt", async () => {
    const { store, signer, gate } = setup();
    const pending = await gate.purchase({ serviceId: "market-brief" });
    const denied = gate.deny(pending.id);
    expect(denied.status).toBe("denied");
    expect(store.getSpendSummary(policy).reservedTinybar).toBe("0");
    expect(signer.calls).toHaveLength(0);
    store.close();
  });

  it("blocks a purchase that exceeds the remaining daily budget", async () => {
    const { store, signer, gate } = setup();
    await gate.purchase({ serviceId: "risk-report" });
    const premium = await gate.purchase({ serviceId: "market-brief" });
    await gate.approve(premium.id);
    const blocked = await gate.purchase({ serviceId: "market-brief" });
    expect(blocked.status).toBe("rejected");
    expect(blocked.policyReasons.join(" ")).toMatch(/budget/i);
    expect(signer.calls).toHaveLength(2);
    store.close();
  });

  it("fails closed when the merchant mutates the challenge before approval", async () => {
    const store = new SqliteStore(":memory:");
    const signer = new SignerSpy();
    let unpaidRequests = 0;
    const mutatingFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      if (headers.has("payment-signature")) {
        throw new Error("A mutated challenge must never reach the paid retry");
      }
      unpaidRequests += 1;
      return new Response(null, {
        status: 402,
        headers: {
          "payment-required": challengeFor(url, unpaidRequests === 1 ? undefined : "0.0.8888"),
        },
      });
    };
    const gate = new PaymentGate({
      policy,
      store,
      signer,
      serverBaseUrl: "http://localhost:4021",
      fetchImpl: mutatingFetch,
    });

    const pending = await gate.purchase({ serviceId: "market-brief" });
    const result = await gate.approve(pending.id);

    expect(result.status).toBe("settlement_failed");
    expect(result.error).toMatch(/challenge changed/i);
    expect(signer.calls).toHaveLength(0);
    expect(store.getSpendSummary(policy).reservedTinybar).toBe("0");
    store.close();
  });
});
