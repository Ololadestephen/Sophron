import type { PolicyContract, PolicyOutcome } from "../core/contracts.js";

export interface PaymentIntentForPolicy {
  merchantId: string;
  origin: string;
  payToAccountId: string;
  amountTinybar: string;
  asset: string;
  network: string;
}

export interface PolicyEvaluationContext {
  settledTinybar: string;
  reservedTinybar: string;
}

export interface PolicyEvaluation {
  outcome: PolicyOutcome;
  reasons: string[];
}

const parseTinybar = (value: string, field: string): bigint => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative tinybar integer string`);
  }
  return BigInt(value);
};

export const evaluatePolicy = (
  policy: PolicyContract,
  intent: PaymentIntentForPolicy,
  context: PolicyEvaluationContext,
): PolicyEvaluation => {
  const amount = parseTinybar(intent.amountTinybar, "amountTinybar");
  const maxPerRequest = parseTinybar(policy.maxPerRequestTinybar, "maxPerRequestTinybar");
  const dailyLimit = parseTinybar(policy.dailyLimitTinybar, "dailyLimitTinybar");
  const approvalAbove = parseTinybar(policy.approvalAboveTinybar, "approvalAboveTinybar");
  const settled = parseTinybar(context.settledTinybar, "settledTinybar");
  const reserved = parseTinybar(context.reservedTinybar, "reservedTinybar");

  const merchant = policy.allowedMerchants.find((candidate) => candidate.id === intent.merchantId);
  if (!merchant) {
    return { outcome: "rejected", reasons: [`Merchant ${intent.merchantId} is not allowlisted`] };
  }

  if (merchant.payToAccountId !== intent.payToAccountId) {
    return {
      outcome: "rejected",
      reasons: ["Payment destination does not match the allowlisted merchant account"],
    };
  }

  if (!merchant.origins.includes(intent.origin)) {
    return {
      outcome: "rejected",
      reasons: ["Resource origin does not match the allowlisted merchant origins"],
    };
  }

  if (intent.asset !== "0.0.0") {
    return { outcome: "rejected", reasons: ["Only native HBAR payments are allowed"] };
  }

  if (intent.network !== "hedera:testnet") {
    return { outcome: "rejected", reasons: ["Only Hedera testnet payments are allowed"] };
  }

  if (amount === 0n) {
    return { outcome: "rejected", reasons: ["Zero-value payment challenges are not allowed"] };
  }

  if (amount > maxPerRequest) {
    return {
      outcome: "rejected",
      reasons: [`Request exceeds the ${policy.maxPerRequestTinybar} tinybar per-request limit`],
    };
  }

  if (settled + reserved + amount > dailyLimit) {
    return {
      outcome: "rejected",
      reasons: [`Request exceeds the remaining UTC-day budget`],
    };
  }

  if (amount > approvalAbove) {
    return {
      outcome: "pending_approval",
      reasons: [`Request exceeds the ${policy.approvalAboveTinybar} tinybar approval threshold`],
    };
  }

  return {
    outcome: "approved",
    reasons: ["Merchant, destination, amount, asset, network, and UTC-day budget passed policy"],
  };
};

export const tinybarToHbar = (tinybar: string): string => {
  const value = parseTinybar(tinybar, "tinybar");
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
