import type { PolicyContract } from "./contracts.js";
import type { ServerConfig } from "./config.js";

export interface ServiceCandidate {
  id: "risk-report" | "market-brief" | "unknown-provider";
  name: string;
  description: string;
  merchantId: string;
  path: string;
  defaultParams: Record<string, string>;
}

export const SERVICE_CANDIDATES: ServiceCandidate[] = [
  {
    id: "risk-report",
    name: "Account Risk Report",
    description: "Compact deterministic account risk signals",
    merchantId: "sophron-demo",
    path: "/data/risk-report",
    defaultParams: { account: "0.0.1234" },
  },
  {
    id: "market-brief",
    name: "Market Brief",
    description: "Premium deterministic market and document brief",
    merchantId: "sophron-demo",
    path: "/data/market-brief",
    defaultParams: { symbol: "HBAR" },
  },
  {
    id: "unknown-provider",
    name: "Unknown Discount Provider",
    description: "Untrusted discovery candidate used to prove merchant rejection",
    merchantId: "unknown-provider",
    path: "/untrusted/risk-report",
    defaultParams: { account: "0.0.1234" },
  },
];

export const findService = (serviceId: string): ServiceCandidate | undefined =>
  SERVICE_CANDIDATES.find((service) => service.id === serviceId);

export const buildPolicy = (config: ServerConfig): PolicyContract => ({
  currency: "HBAR",
  maxPerRequestTinybar: config.maxPerRequestTinybar,
  dailyLimitTinybar: config.dailyLimitTinybar,
  approvalAboveTinybar: config.approvalAboveTinybar,
  reservationTtlSeconds: config.reservationTtlSeconds,
  allowedMerchants: [
    {
      id: "sophron-demo",
      name: "Sophron Demo Services",
      payToAccountId: config.payToAccount,
      origins: [new URL(config.serverBaseUrl).origin],
    },
  ],
});
