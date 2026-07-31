import { randomUUID } from "node:crypto";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type {
  AttemptContract,
  PolicyContract,
} from "../core/contracts.js";
import type { ServiceCandidate } from "../core/services.js";
import { findService } from "../core/services.js";
import { evaluatePolicy } from "../policy/engine.js";
import type { SqliteStore } from "../storage/sqlite-store.js";
import { hashReceipt, normalizeChallenge } from "./challenge.js";
import type { PaymentSigner } from "./signer.js";

export interface PurchaseInput {
  serviceId: string;
  params?: Record<string, string>;
}

export interface PaymentGateOptions {
  policy: PolicyContract;
  store: SqliteStore;
  signer: PaymentSigner;
  serverBaseUrl: string;
  fetchImpl?: typeof fetch;
}

const buildResourceUrl = (
  serverBaseUrl: string,
  service: ServiceCandidate,
  params: Record<string, string>,
): string => {
  const url = new URL(service.path, serverBaseUrl);
  for (const [key, value] of Object.entries({ ...service.defaultParams, ...params })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

export class PaymentGate {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PaymentGateOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async purchase(input: PurchaseInput): Promise<AttemptContract> {
    const service = findService(input.serviceId);
    if (!service) throw new Error(`Unknown service: ${input.serviceId}`);
    const resourceUrl = buildResourceUrl(this.options.serverBaseUrl, service, input.params ?? {});
    const unpaid = await this.fetchImpl(resourceUrl, { headers: { accept: "application/json" } });
    if (unpaid.status !== 402) {
      throw new Error(`Expected HTTP 402 from ${service.id}, received ${unpaid.status}`);
    }
    const header = unpaid.headers.get("payment-required");
    if (!header) throw new Error("HTTP 402 response did not include payment-required");
    const challenge = normalizeChallenge(header);
    const attemptId = randomUUID();
    const attempt = this.options.store.createAttempt({
      id: attemptId,
      serviceId: service.id,
      serviceName: service.name,
      merchantId: service.merchantId,
      resourceUrl,
      amountTinybar: challenge.requirement.amount,
      challengeHash: challenge.challengeHash,
      paymentRequiredHeader: challenge.rawHeader,
    });

    const evaluation = evaluatePolicy(
      this.options.policy,
      {
        merchantId: service.merchantId,
        origin: new URL(resourceUrl).origin,
        payToAccountId: challenge.requirement.payTo,
        amountTinybar: challenge.requirement.amount,
        asset: challenge.requirement.asset,
        network: challenge.requirement.network,
      },
      this.options.store.getSpendSummary(this.options.policy),
    );

    if (evaluation.outcome === "rejected") {
      return this.options.store.transition(
        attempt.id,
        "rejected",
        { policyOutcome: "rejected", policyReasons: evaluation.reasons },
        "policy_rejected",
      );
    }

    const reservation = this.options.store.reserveIfWithinBudget(
      attempt.id,
      attempt.amountTinybar,
      this.options.policy.dailyLimitTinybar,
      this.options.policy.reservationTtlSeconds,
    );
    if (!reservation.reserved || !reservation.expiresAt) {
      return this.options.store.transition(
        attempt.id,
        "rejected",
        { policyOutcome: "rejected", policyReasons: ["UTC-day budget could not be reserved"] },
        "reservation_rejected",
      );
    }

    if (evaluation.outcome === "pending_approval") {
      return this.options.store.transition(
        attempt.id,
        "pending_approval",
        {
          policyOutcome: "pending_approval",
          policyReasons: evaluation.reasons,
          reservationExpiresAt: reservation.expiresAt,
        },
        "approval_requested",
      );
    }

    this.options.store.transition(
      attempt.id,
      "authorized",
      {
        policyOutcome: "approved",
        policyReasons: evaluation.reasons,
        reservationExpiresAt: reservation.expiresAt,
      },
      "policy_authorized",
    );
    return this.executeAuthorized(attempt.id);
  }

  async approve(attemptId: string): Promise<AttemptContract> {
    const attempt = this.options.store.requireAttempt(attemptId);
    if (attempt.status !== "pending_approval") {
      throw new Error(`Attempt ${attemptId} is not pending approval`);
    }
    if (!this.options.store.hasActiveReservation(attemptId)) {
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: "Approval reservation expired" },
        "approval_expired",
      );
    }
    this.options.store.transition(attemptId, "authorized", {}, "human_approved");
    return this.executeAuthorized(attemptId);
  }

  deny(attemptId: string): AttemptContract {
    const attempt = this.options.store.requireAttempt(attemptId);
    if (attempt.status !== "pending_approval") {
      throw new Error(`Attempt ${attemptId} is not pending approval`);
    }
    this.options.store.releaseReservation(attemptId);
    return this.options.store.transition(attemptId, "denied", {}, "human_denied");
  }

  private async executeAuthorized(attemptId: string): Promise<AttemptContract> {
    const attempt = this.options.store.requireAttempt(attemptId);
    const service = findService(attempt.serviceId);
    const rawHeader = this.options.store.getPaymentRequiredHeader(attemptId);
    if (!service || !rawHeader) throw new Error("Attempt is missing service or challenge data");
    const storedChallenge = normalizeChallenge(rawHeader);

    let challenge;
    try {
      const freshUnpaid = await this.fetchImpl(attempt.resourceUrl, {
        headers: { accept: "application/json" },
      });
      if (freshUnpaid.status !== 402) {
        throw new Error(`Expected a fresh HTTP 402 before signing, received ${freshUnpaid.status}`);
      }
      const freshHeader = freshUnpaid.headers.get("payment-required");
      if (!freshHeader) throw new Error("Fresh HTTP 402 did not include payment-required");
      challenge = normalizeChallenge(freshHeader);
    } catch (error) {
      this.options.store.releaseReservation(attemptId);
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: error instanceof Error ? error.message : "Fresh challenge validation failed" },
        "challenge_refresh_failed",
      );
    }

    if (
      storedChallenge.challengeHash !== attempt.challengeHash ||
      challenge.challengeHash !== attempt.challengeHash
    ) {
      this.options.store.releaseReservation(attemptId);
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: "Payment challenge changed after authorization" },
        "challenge_mismatch",
      );
    }

    if (!this.options.store.hasActiveReservation(attemptId)) {
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: "Budget reservation is no longer active" },
        "reservation_expired",
      );
    }

    const spend = this.options.store.getSpendSummary(this.options.policy);
    const reservedExcludingThis = (
      BigInt(spend.reservedTinybar) - BigInt(attempt.amountTinybar)
    ).toString();
    const evaluation = evaluatePolicy(
      this.options.policy,
      {
        merchantId: service.merchantId,
        origin: new URL(attempt.resourceUrl).origin,
        payToAccountId: challenge.requirement.payTo,
        amountTinybar: challenge.requirement.amount,
        asset: challenge.requirement.asset,
        network: challenge.requirement.network,
      },
      { settledTinybar: spend.settledTinybar, reservedTinybar: reservedExcludingThis },
    );
    if (evaluation.outcome === "rejected") {
      this.options.store.releaseReservation(attemptId);
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: `Policy re-evaluation failed: ${evaluation.reasons.join("; ")}` },
        "policy_recheck_failed",
      );
    }

    try {
      this.options.store.transition(attemptId, "signing", {}, "signer_called");
      const signature = await this.options.signer.signPaymentRequired(challenge.rawHeader);
      this.options.store.transition(attemptId, "submitted", {}, "payment_submitted");
      const paid = await this.fetchImpl(attempt.resourceUrl, {
        headers: { accept: "application/json", "payment-signature": signature },
      });
      if (!paid.ok) {
        throw new Error(`Paid resource retry failed with HTTP ${paid.status}: ${await paid.text()}`);
      }
      const paymentResponseHeader = paid.headers.get("payment-response");
      if (!paymentResponseHeader) throw new Error("Paid response did not include payment-response");
      const settlement = decodePaymentResponseHeader(paymentResponseHeader);
      if (!settlement.success || !settlement.transaction) {
        throw new Error(settlement.errorMessage ?? settlement.errorReason ?? "Facilitator settlement failed");
      }
      const body = (await paid.json()) as unknown;
      const hashscanUrl = `https://hashscan.io/testnet/transaction/${encodeURIComponent(settlement.transaction)}`;
      this.options.store.transition(
        attemptId,
        "settled",
        { transactionId: settlement.transaction, hashscanUrl },
        "payment_settled",
      );
      const receipt = {
        attemptId,
        challengeHash: challenge.challengeHash,
        transactionId: settlement.transaction,
        network: settlement.network,
        payer: settlement.payer ?? null,
        amountTinybar: attempt.amountTinybar,
        merchantId: attempt.merchantId,
        resourceUrl: attempt.resourceUrl,
      };
      this.options.store.saveReceipt(
        attemptId,
        challenge.challengeHash,
        settlement.transaction,
        receipt,
        hashReceipt(receipt),
      );
      this.options.store.consumeReservation(attemptId);
      return this.options.store.transition(
        attemptId,
        "fulfilled",
        { responsePreview: body },
        "resource_fulfilled",
      );
    } catch (error) {
      this.options.store.releaseReservation(attemptId);
      return this.options.store.transition(
        attemptId,
        "settlement_failed",
        { error: error instanceof Error ? error.message : "Unknown settlement error" },
        "settlement_failed",
      );
    }
  }
}
