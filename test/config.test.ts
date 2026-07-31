import { describe, it, expect, afterEach, vi } from "vitest";
import { loadConfig } from "../src/core/config.js";

afterEach(() => vi.unstubAllEnvs());

const stubAll = () => {
  vi.stubEnv("HEDERA_NETWORK", "hedera:testnet");
  vi.stubEnv("FACILITATOR_URL", "https://api.testnet.blocky402.com");
  vi.stubEnv("PAY_TO_ACCOUNT", "0.0.1234");
  vi.stubEnv("DATA_PROVIDER", "mock");
  vi.stubEnv("PORT", "4021");
};

describe("loadConfig", () => {
  it("throws when a required env var is missing", () => {
    vi.stubEnv("HEDERA_NETWORK", "");
    vi.stubEnv("FACILITATOR_URL", "");
    vi.stubEnv("PAY_TO_ACCOUNT", "");
    expect(() => loadConfig()).toThrow(/FACILITATOR_URL|HEDERA_NETWORK|PAY_TO_ACCOUNT/);
  });

  it("returns a typed config when all vars are present", () => {
    stubAll();
    expect(loadConfig()).toEqual({
      hederaNetwork: "hedera:testnet",
      facilitatorUrl: "https://api.testnet.blocky402.com",
      payToAccount: "0.0.1234",
      untrustedPayToAccount: "0.0.999999",
      dataProvider: "mock",
      port: 4021,
      serverBaseUrl: "http://localhost:4021",
      databasePath: "./data/sophron.db",
      maxPerRequestTinybar: "5000000",
      dailyLimitTinybar: "10000000",
      approvalAboveTinybar: "2000000",
      reservationTtlSeconds: 900,
      openAiModel: "gpt-4o-mini",
      demoMode: false,
      dashboardOrigin: "http://localhost:4321",
    });
  });

  it("fails fast for mainnet or incoherent policy limits", () => {
    stubAll();
    vi.stubEnv("HEDERA_NETWORK", "hedera:mainnet");
    expect(() => loadConfig()).toThrow(/testnet/);

    vi.stubEnv("HEDERA_NETWORK", "hedera:testnet");
    vi.stubEnv("SOPHRON_APPROVAL_ABOVE_TINYBAR", "5000001");
    expect(() => loadConfig()).toThrow(/Policy limits/);
  });
});
