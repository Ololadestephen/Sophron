import type {
  AttemptContract,
  AttemptResponseContract,
  AuditEventContract,
  PolicyResponseContract,
} from "../lib/types";

const DAY = "2026-07-25";

export const fixturePolicy: PolicyResponseContract = {
  policy: {
    currency: "HBAR",
    maxPerRequestTinybar: "5000000", // 0.05 ℏ
    dailyLimitTinybar: "10000000", // 0.1 ℏ
    approvalAboveTinybar: "2000000", // 0.02 ℏ
    reservationTtlSeconds: 900,
    allowedMerchants: [
      {
        id: "sophron-demo",
        name: "Sophron Demo Services",
        payToAccountId: "0.0.1234",
        origins: ["http://localhost:4021"],
      },
    ],
  },
  spend: {
    utcDay: DAY,
    settledTinybar: "1000000", // 0.01
    reservedTinybar: "3000000", // 0.03 pending
    remainingTinybar: "2000000", // 0.02
  },
};

function event(
  id: number,
  attemptId: string,
  type: string,
  from: AttemptContract["status"] | null,
  to: AttemptContract["status"],
  createdAt: string,
  metadata: Record<string, unknown> = {},
): AuditEventContract {
  return { id, attemptId, type, fromStatus: from, toStatus: to, metadata, createdAt };
}

/** Realistic demo sequence: rejected → fulfilled → pending → budget-blocked. */
export const fixtureAttempts: AttemptContract[] = [
  {
    id: "att_reject_01",
    serviceId: "unknown-provider",
    serviceName: "Shadow risk feed",
    merchantId: "unknown-provider",
    resourceUrl: "http://localhost:4021/untrusted/risk-report?account=0.0.1234",
    amountTinybar: "500000",
    currency: "HBAR",
    status: "rejected",
    policyOutcome: "rejected",
    policyReasons: [
      "Merchant unknown-provider is not allowlisted",
    ],
    challengeHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    reservationExpiresAt: null,
    transactionId: null,
    hashscanUrl: null,
    responsePreview: null,
    error: null,
    createdAt: `${DAY}T14:02:11.000Z`,
    updatedAt: `${DAY}T14:02:11.200Z`,
  },
  {
    id: "att_auto_02",
    serviceId: "risk-report",
    serviceName: "Account risk report",
    merchantId: "sophron-demo",
    resourceUrl: "http://localhost:4021/data/risk-report?account=0.0.1234",
    amountTinybar: "1000000",
    currency: "HBAR",
    status: "fulfilled",
    policyOutcome: "approved",
    policyReasons: [
      "Merchant allowlisted",
      "Amount within per-request maximum",
      "Amount at or below approval threshold — auto-approved",
      "Within UTC-day budget including reservations",
    ],
    challengeHash: "f0e1d2c3b4a5968778695a4b3c2d1e0f00112233445566778899aabbccddeeff",
    reservationExpiresAt: null,
    transactionId: "0.0.4515756@1721912532.123456789",
    hashscanUrl:
      "https://hashscan.io/testnet/transaction/0.0.4515756@1721912532.123456789",
    responsePreview: {
      product: "risk-report",
      account: "0.0.1234",
      score: 42,
      band: "moderate",
      asOf: `${DAY}T14:05:00.000Z`,
      demo: true,
    },
    error: null,
    createdAt: `${DAY}T14:05:01.000Z`,
    updatedAt: `${DAY}T14:05:04.800Z`,
  },
  {
    id: "att_pending_03",
    serviceId: "market-brief",
    serviceName: "Premium market brief",
    merchantId: "sophron-demo",
    resourceUrl: "http://localhost:4021/data/market-brief?symbol=HBAR",
    amountTinybar: "3000000",
    currency: "HBAR",
    status: "pending_approval",
    policyOutcome: "pending_approval",
    policyReasons: [
      "Merchant allowlisted",
      "Amount within per-request maximum",
      "Amount above approval threshold — human approval required",
      "Reservation held against UTC-day budget",
    ],
    challengeHash: "11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff",
    reservationExpiresAt: `${DAY}T14:22:00.000Z`,
    transactionId: null,
    hashscanUrl: null,
    responsePreview: null,
    error: null,
    createdAt: `${DAY}T14:07:00.000Z`,
    updatedAt: `${DAY}T14:07:00.400Z`,
  },
  {
    id: "att_budget_04",
    serviceId: "market-brief",
    serviceName: "Premium market brief",
    merchantId: "sophron-demo",
    resourceUrl: "http://localhost:4021/data/market-brief?symbol=HBAR",
    amountTinybar: "3000000",
    currency: "HBAR",
    status: "rejected",
    policyOutcome: "rejected",
    policyReasons: [
      "Merchant allowlisted",
      "Amount within per-request maximum",
      "UTC-day settled + reserved + amount exceeds daily limit",
    ],
    challengeHash: "99aa88bb77cc66dd55ee44ff33221100ffeeddccbbaa00998877665544332211",
    reservationExpiresAt: null,
    transactionId: null,
    hashscanUrl: null,
    responsePreview: null,
    error: null,
    createdAt: `${DAY}T14:09:30.000Z`,
    updatedAt: `${DAY}T14:09:30.150Z`,
  },
];

const eventsByAttempt: Record<string, AuditEventContract[]> = {
  att_reject_01: [
    event(1, "att_reject_01", "created", null, "proposed", `${DAY}T14:02:11.000Z`),
    event(2, "att_reject_01", "challenged", "proposed", "challenged", `${DAY}T14:02:11.050Z`),
    event(3, "att_reject_01", "policy_rejected", "challenged", "rejected", `${DAY}T14:02:11.200Z`, {
      reasons: fixtureAttempts[0].policyReasons,
    }),
  ],
  att_auto_02: [
    event(4, "att_auto_02", "created", null, "proposed", `${DAY}T14:05:01.000Z`),
    event(5, "att_auto_02", "challenged", "proposed", "challenged", `${DAY}T14:05:01.100Z`),
    event(6, "att_auto_02", "policy_approved", "challenged", "authorized", `${DAY}T14:05:01.200Z`),
    event(7, "att_auto_02", "signing", "authorized", "signing", `${DAY}T14:05:02.000Z`),
    event(8, "att_auto_02", "submitted", "signing", "submitted", `${DAY}T14:05:02.500Z`),
    event(9, "att_auto_02", "settled", "submitted", "settled", `${DAY}T14:05:03.500Z`, {
      transactionId: fixtureAttempts[1].transactionId,
    }),
    event(10, "att_auto_02", "fulfilled", "settled", "fulfilled", `${DAY}T14:05:04.800Z`),
  ],
  att_pending_03: [
    event(11, "att_pending_03", "created", null, "proposed", `${DAY}T14:07:00.000Z`),
    event(12, "att_pending_03", "challenged", "proposed", "challenged", `${DAY}T14:07:00.100Z`),
    event(
      13,
      "att_pending_03",
      "policy_pending_approval",
      "challenged",
      "pending_approval",
      `${DAY}T14:07:00.400Z`,
      { reservationExpiresAt: fixtureAttempts[2].reservationExpiresAt },
    ),
  ],
  att_budget_04: [
    event(14, "att_budget_04", "created", null, "proposed", `${DAY}T14:09:30.000Z`),
    event(15, "att_budget_04", "challenged", "proposed", "challenged", `${DAY}T14:09:30.080Z`),
    event(16, "att_budget_04", "policy_rejected", "challenged", "rejected", `${DAY}T14:09:30.150Z`, {
      reasons: fixtureAttempts[3].policyReasons,
    }),
  ],
};

export function getFixtureAttemptDetail(id: string): AttemptResponseContract | null {
  const attempt = fixtureAttempts.find((a) => a.id === id);
  if (!attempt) return null;
  return {
    attempt,
    events: eventsByAttempt[id] ?? [],
  };
}

/** Mutable fixture state for in-memory Approve/Deny/Reset demos. */
export function createFixtureStore() {
  let policy: PolicyResponseContract = structuredClone(fixturePolicy);
  let attempts: AttemptContract[] = structuredClone(fixtureAttempts);
  let eventMap: Record<string, AuditEventContract[]> = structuredClone(eventsByAttempt);
  let nextEventId = 100;

  return {
    getPolicy: () => policy,
    getAttempts: () =>
      [...attempts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    getDetail: (id: string): AttemptResponseContract | null => {
      const attempt = attempts.find((a) => a.id === id);
      if (!attempt) return null;
      return { attempt, events: eventMap[id] ?? [] };
    },
    approve: (id: string): AttemptResponseContract | null => {
      const idx = attempts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const current = attempts[idx];
      if (current.status !== "pending_approval") return null;
      const now = new Date().toISOString();
      const updated: AttemptContract = {
        ...current,
        status: "fulfilled",
        policyOutcome: "approved",
        reservationExpiresAt: null,
        transactionId: `0.0.4515756@${Math.floor(Date.now() / 1000)}.000000001`,
        hashscanUrl: `https://hashscan.io/testnet/transaction/0.0.4515756@${Math.floor(Date.now() / 1000)}.000000001`,
        responsePreview: {
          product: current.serviceId,
          demo: true,
          note: "Fixture-mode fulfilled after approve",
        },
        updatedAt: now,
      };
      attempts = attempts.map((a, i) => (i === idx ? updated : a));
      const ev = eventMap[id] ?? [];
      ev.push(
        event(++nextEventId, id, "human_approved", "pending_approval", "authorized", now),
        event(++nextEventId, id, "settled", "authorized", "settled", now),
        event(++nextEventId, id, "fulfilled", "settled", "fulfilled", now),
      );
      eventMap = { ...eventMap, [id]: ev };
      // release reservation into settled
      const reserved = BigInt(policy.spend.reservedTinybar);
      const amount = BigInt(current.amountTinybar);
      const settled = BigInt(policy.spend.settledTinybar) + amount;
      const newReserved = reserved >= amount ? reserved - amount : 0n;
      const daily = BigInt(policy.policy.dailyLimitTinybar);
      const remaining = daily > settled + newReserved ? daily - settled - newReserved : 0n;
      policy = {
        ...policy,
        spend: {
          ...policy.spend,
          settledTinybar: settled.toString(),
          reservedTinybar: newReserved.toString(),
          remainingTinybar: remaining.toString(),
        },
      };
      return { attempt: updated, events: eventMap[id] };
    },
    deny: (id: string): AttemptResponseContract | null => {
      const idx = attempts.findIndex((a) => a.id === id);
      if (idx < 0) return null;
      const current = attempts[idx];
      if (current.status !== "pending_approval") return null;
      const now = new Date().toISOString();
      const updated: AttemptContract = {
        ...current,
        status: "denied",
        reservationExpiresAt: null,
        updatedAt: now,
      };
      attempts = attempts.map((a, i) => (i === idx ? updated : a));
      const ev = eventMap[id] ?? [];
      ev.push(event(++nextEventId, id, "human_denied", "pending_approval", "denied", now));
      eventMap = { ...eventMap, [id]: ev };
      const reserved = BigInt(policy.spend.reservedTinybar);
      const amount = BigInt(current.amountTinybar);
      const newReserved = reserved >= amount ? reserved - amount : 0n;
      const settled = BigInt(policy.spend.settledTinybar);
      const daily = BigInt(policy.policy.dailyLimitTinybar);
      const remaining = daily > settled + newReserved ? daily - settled - newReserved : 0n;
      policy = {
        ...policy,
        spend: {
          ...policy.spend,
          reservedTinybar: newReserved.toString(),
          remainingTinybar: remaining.toString(),
        },
      };
      return { attempt: updated, events: eventMap[id] };
    },
    reset: () => {
      policy = structuredClone(fixturePolicy);
      attempts = structuredClone(fixtureAttempts);
      eventMap = structuredClone(eventsByAttempt);
      nextEventId = 100;
      return policy;
    },
    runAgent: (serviceId: string, prompt: string): AttemptContract => {
      const now = new Date().toISOString();
      const id = `att_fixture_${Date.now()}`;
      const attempt: AttemptContract = {
        id,
        serviceId,
        serviceName:
          serviceId === "market-brief"
            ? "Premium market brief"
            : serviceId === "unknown-provider"
              ? "Shadow risk feed"
              : "Account risk report",
        merchantId:
          serviceId === "unknown-provider"
            ? "unknown-provider"
            : "sophron-demo",
        resourceUrl:
          serviceId === "unknown-provider"
            ? "http://localhost:4021/untrusted/risk-report"
            : `http://localhost:4021/data/${serviceId}`,
        amountTinybar:
          serviceId === "market-brief"
            ? "3000000"
            : serviceId === "unknown-provider"
              ? "500000"
              : "1000000",
        currency: "HBAR",
        status: serviceId === "unknown-provider" ? "rejected" : serviceId === "market-brief" ? "pending_approval" : "fulfilled",
        policyOutcome:
          serviceId === "unknown-provider"
            ? "rejected"
            : serviceId === "market-brief"
              ? "pending_approval"
              : "approved",
        policyReasons:
          serviceId === "unknown-provider"
            ? ["Merchant not on allowlist (fixture run)"]
            : serviceId === "market-brief"
              ? ["Above approval threshold — human approval required (fixture)"]
              : ["Auto-approved within budget (fixture)"],
        challengeHash: "fixture" + id.replace(/\W/g, "").slice(0, 56).padEnd(56, "0"),
        reservationExpiresAt:
          serviceId === "market-brief" ? new Date(Date.now() + 900_000).toISOString() : null,
        transactionId:
          serviceId === "risk-report" ? `0.0.4515756@${Math.floor(Date.now() / 1000)}.1` : null,
        hashscanUrl:
          serviceId === "risk-report"
            ? `https://hashscan.io/testnet/transaction/0.0.4515756@${Math.floor(Date.now() / 1000)}.1`
            : null,
        responsePreview:
          serviceId === "risk-report" ? { demo: true, prompt, product: serviceId } : null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      attempts = [attempt, ...attempts];
      eventMap[id] = [
        event(++nextEventId, id, "created", null, "proposed", now),
        event(
          ++nextEventId,
          id,
          "terminal",
          "proposed",
          attempt.status,
          now,
          { fixture: true },
        ),
      ];
      return attempt;
    },
  };
}

export type FixtureStore = ReturnType<typeof createFixtureStore>;
