import { describe, expect, it } from "vitest";
import { createFixtureStore, fixtureAttempts, fixturePolicy } from "../src/data/fixtures";

describe("dashboard fixtures", () => {
  it("mirror the backend policy and demonstrate each decision path", () => {
    expect(fixturePolicy.policy).toMatchObject({
      maxPerRequestTinybar: "5000000",
      dailyLimitTinybar: "6000000",
      approvalAboveTinybar: "2000000",
      reservationTtlSeconds: 900,
    });
    expect(fixturePolicy.policy.allowedMerchants.map((merchant) => merchant.id)).toEqual([
      "sophron-demo",
    ]);

    const byStatus = new Map(fixtureAttempts.map((attempt) => [attempt.status, attempt]));
    expect(byStatus.get("fulfilled")?.amountTinybar).toBe("1000000");
    expect(byStatus.get("pending_approval")?.amountTinybar).toBe("3000000");
    expect(
      fixtureAttempts.some(
        (attempt) => attempt.status === "rejected" && attempt.merchantId === "unknown-provider",
      ),
    ).toBe(true);
    expect(
      fixtureAttempts.some(
        (attempt) => attempt.status === "rejected" && attempt.policyReasons.join(" ").includes("daily limit"),
      ),
    ).toBe(true);
  });

  it("moves an approved reservation into settled spend", () => {
    const store = createFixtureStore();
    const pending = store.getAttempts().find((attempt) => attempt.status === "pending_approval");
    expect(pending).toBeDefined();

    const result = store.approve(pending!.id);
    expect(result?.attempt.status).toBe("fulfilled");
    expect(store.getPolicy().spend).toMatchObject({
      settledTinybar: "4000000",
      reservedTinybar: "0",
      remainingTinybar: "2000000",
    });
  });
});
