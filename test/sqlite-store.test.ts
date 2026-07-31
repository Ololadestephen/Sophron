import { describe, expect, it } from "vitest";
import type { PolicyContract } from "../src/core/contracts.js";
import { SqliteStore } from "../src/storage/sqlite-store.js";

const policy: PolicyContract = {
  currency: "HBAR",
  maxPerRequestTinybar: "5000000",
  dailyLimitTinybar: "6000000",
  approvalAboveTinybar: "2000000",
  reservationTtlSeconds: 900,
  allowedMerchants: [],
};

const createAttempt = (store: SqliteStore, id: string, amountTinybar = "1000000") =>
  store.createAttempt({
    id,
    serviceId: "risk-report",
    serviceName: "Risk report",
    merchantId: "sophron-demo",
    resourceUrl: "http://localhost:4021/data/risk-report?account=0.0.1",
    amountTinybar,
    challengeHash: `hash-${id}`,
    paymentRequiredHeader: `header-${id}`,
  });

describe("SqliteStore", () => {
  it("persists attempts and append-only audit events", () => {
    const store = new SqliteStore(":memory:");
    createAttempt(store, "a1");
    store.transition("a1", "pending_approval", {
      policyOutcome: "pending_approval",
      policyReasons: ["approval required"],
    });
    expect(store.requireAttempt("a1").status).toBe("pending_approval");
    expect(store.getEvents("a1")).toHaveLength(2);
    store.close();
  });

  it("atomically rejects reservations beyond the daily budget", () => {
    const store = new SqliteStore(":memory:");
    createAttempt(store, "a1", "4000000");
    createAttempt(store, "a2", "3000000");
    expect(store.reserveIfWithinBudget("a1", "4000000", "6000000", 900).reserved).toBe(true);
    expect(store.reserveIfWithinBudget("a2", "3000000", "6000000", 900).reserved).toBe(false);
    expect(store.getSpendSummary(policy).reservedTinybar).toBe("4000000");
    store.close();
  });

  it("releases reservations after denial", () => {
    const store = new SqliteStore(":memory:");
    createAttempt(store, "a1", "4000000");
    store.reserveIfWithinBudget("a1", "4000000", "6000000", 900);
    store.releaseReservation("a1");
    expect(store.getSpendSummary(policy).reservedTinybar).toBe("0");
    store.close();
  });

  it("expires stale reservations", () => {
    const store = new SqliteStore(":memory:");
    createAttempt(store, "a1");
    const start = new Date("2026-07-25T10:00:00.000Z");
    store.reserveIfWithinBudget("a1", "1000000", "6000000", 1, start);
    expect(store.hasActiveReservation("a1", new Date("2026-07-25T10:00:02.000Z"))).toBe(false);
    store.close();
  });
});
