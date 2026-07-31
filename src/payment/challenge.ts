import { createHash } from "node:crypto";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

export interface NormalizedChallenge {
  rawHeader: string;
  challengeHash: string;
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
}

export const normalizeChallenge = (
  paymentRequiredHeader: string,
  expectedNetwork = "hedera:testnet",
): NormalizedChallenge => {
  const trimmed = paymentRequiredHeader.trim();
  if (!trimmed) throw new Error("Missing payment-required header");
  const decodedBytes = Buffer.from(trimmed, "base64");
  if (decodedBytes.length === 0) throw new Error("Invalid payment-required header encoding");
  const paymentRequired = decodePaymentRequiredHeader(trimmed);
  const requirement = paymentRequired.accepts.find(
    (candidate) => candidate.scheme === "exact" && candidate.network === expectedNetwork,
  );
  if (!requirement) throw new Error(`No exact ${expectedNetwork} payment option in challenge`);
  return {
    rawHeader: trimmed,
    challengeHash: createHash("sha256").update(decodedBytes).digest("hex"),
    paymentRequired,
    requirement,
  };
};

export const hashReceipt = (receipt: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
