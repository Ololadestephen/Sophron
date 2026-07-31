import {
  createClientHederaSigner,
  PrivateKey as HederaPrivateKey,
} from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";

export interface PaymentSigner {
  signPaymentRequired(paymentRequiredHeader: string): Promise<string>;
}

export class UnavailablePaymentSigner implements PaymentSigner {
  constructor(private readonly reason: string) {}

  async signPaymentRequired(): Promise<string> {
    throw new Error(this.reason);
  }
}

export class HederaPaymentSigner implements PaymentSigner {
  private readonly client: x402Client;

  constructor(accountId: string, privateKey: string, network = "hedera:testnet") {
    const signer = createClientHederaSigner(
      accountId,
      HederaPrivateKey.fromStringECDSA(privateKey),
      { network },
    );
    this.client = new x402Client().register("hedera:*", new ExactHederaScheme(signer));
  }

  static fromEnvironment(): HederaPaymentSigner {
    const accountId = process.env.HEDERA_CLIENT_ID;
    const privateKey = process.env.HEDERA_CLIENT_KEY;
    if (!accountId || !privateKey) {
      throw new Error("HEDERA_CLIENT_ID and HEDERA_CLIENT_KEY are required for signing");
    }
    return new HederaPaymentSigner(
      accountId,
      privateKey,
      process.env.HEDERA_NETWORK ?? "hedera:testnet",
    );
  }

  async signPaymentRequired(paymentRequiredHeader: string): Promise<string> {
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    const payload = await this.client.createPaymentPayload(paymentRequired);
    return encodePaymentSignatureHeader(payload);
  }
}
