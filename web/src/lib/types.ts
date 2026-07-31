/**
 * Frontend mirrors of src/core/contracts.ts.
 * Keep fields in sync; do not invent conflicting shapes.
 */

export const ATTEMPT_STATUSES = [
  "proposed",
  "challenged",
  "rejected",
  "pending_approval",
  "denied",
  "authorized",
  "signing",
  "submitted",
  "settled",
  "fulfilled",
  "settlement_failed",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export type PolicyOutcome = "approved" | "pending_approval" | "rejected";

export interface MerchantContract {
  id: string;
  name: string;
  payToAccountId: string;
  origins: string[];
}

export interface PolicyContract {
  currency: "HBAR";
  maxPerRequestTinybar: string;
  dailyLimitTinybar: string;
  approvalAboveTinybar: string;
  reservationTtlSeconds: number;
  allowedMerchants: MerchantContract[];
}

export interface SpendSummaryContract {
  utcDay: string;
  settledTinybar: string;
  reservedTinybar: string;
  remainingTinybar: string;
}

export interface AttemptContract {
  id: string;
  serviceId: string;
  serviceName: string;
  merchantId: string;
  resourceUrl: string;
  amountTinybar: string;
  currency: "HBAR";
  status: AttemptStatus;
  policyOutcome: PolicyOutcome | null;
  policyReasons: string[];
  challengeHash: string | null;
  reservationExpiresAt: string | null;
  transactionId: string | null;
  hashscanUrl: string | null;
  responsePreview: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEventContract {
  id: number;
  attemptId: string;
  type: string;
  fromStatus: AttemptStatus | null;
  toStatus: AttemptStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PolicyResponseContract {
  policy: PolicyContract;
  spend: SpendSummaryContract;
}

export interface AttemptsResponseContract {
  attempts: AttemptContract[];
}

export interface AttemptResponseContract {
  attempt: AttemptContract;
  events: AuditEventContract[];
}

export interface AgentRunRequestContract {
  prompt: string;
  serviceId?: string;
  params?: Record<string, string>;
}

export interface AgentRunResponseContract {
  message: string;
  attempt: AttemptContract;
}

export interface DemoResetResponseContract {
  ok: true;
  policy: PolicyResponseContract;
}

export type ServiceId = "risk-report" | "market-brief" | "unknown-provider";
