export interface ServerConfig {
  hederaNetwork: string;
  facilitatorUrl: string;
  payToAccount: string;
  untrustedPayToAccount: string;
  dataProvider: string;
  port: number;
  serverBaseUrl: string;
  databasePath: string;
  maxPerRequestTinybar: string;
  dailyLimitTinybar: string;
  approvalAboveTinybar: string;
  reservationTtlSeconds: number;
  openAiModel: string;
  demoMode: boolean;
  dashboardOrigin: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const positiveInteger = (value: string, name: string, allowZero = false): number => {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${name} must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  }
  return parsed;
};

const tinybarValue = (value: string, name: string): bigint => {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a tinybar integer string`);
  return BigInt(value);
};

const httpUrl = (value: string, name: string): string => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
};

export const loadConfig = (): ServerConfig => {
  const hederaNetwork = required("HEDERA_NETWORK");
  if (hederaNetwork !== "hedera:testnet") {
    throw new Error("Sophron MVP supports only HEDERA_NETWORK=hedera:testnet");
  }

  const maxPerRequestTinybar = process.env.SOPHRON_MAX_PER_REQUEST_TINYBAR ?? "5000000";
  const dailyLimitTinybar = process.env.SOPHRON_DAILY_LIMIT_TINYBAR ?? "6000000";
  const approvalAboveTinybar = process.env.SOPHRON_APPROVAL_ABOVE_TINYBAR ?? "2000000";
  const max = tinybarValue(maxPerRequestTinybar, "SOPHRON_MAX_PER_REQUEST_TINYBAR");
  const daily = tinybarValue(dailyLimitTinybar, "SOPHRON_DAILY_LIMIT_TINYBAR");
  const approval = tinybarValue(approvalAboveTinybar, "SOPHRON_APPROVAL_ABOVE_TINYBAR");
  if (max === 0n || daily === 0n || approval > max || max > daily) {
    throw new Error("Policy limits must satisfy 0 < maxPerRequest <= dailyLimit and approvalAbove <= maxPerRequest");
  }

  const port = positiveInteger(process.env.PORT ?? "4021", "PORT");
  if (port > 65_535) throw new Error("PORT must be at most 65535");

  return {
    hederaNetwork,
    facilitatorUrl: httpUrl(required("FACILITATOR_URL"), "FACILITATOR_URL"),
    payToAccount: required("PAY_TO_ACCOUNT"),
    untrustedPayToAccount: process.env.UNTRUSTED_PAY_TO_ACCOUNT ?? "0.0.999999",
    dataProvider: process.env.DATA_PROVIDER ?? "mock",
    port,
    serverBaseUrl: httpUrl(process.env.SERVER_URL ?? "http://localhost:4021", "SERVER_URL"),
    databasePath: process.env.DATABASE_PATH ?? "./data/sophron.db",
    maxPerRequestTinybar,
    dailyLimitTinybar,
    approvalAboveTinybar,
    reservationTtlSeconds: positiveInteger(
      process.env.SOPHRON_RESERVATION_TTL_SECONDS ?? "900",
      "SOPHRON_RESERVATION_TTL_SECONDS",
    ),
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    demoMode: process.env.SOPHRON_DEMO_MODE === "true",
    dashboardOrigin: new URL(
      httpUrl(process.env.SOPHRON_DASHBOARD_ORIGIN ?? "http://localhost:4321", "SOPHRON_DASHBOARD_ORIGIN"),
    ).origin,
  };
};
