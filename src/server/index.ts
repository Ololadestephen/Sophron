import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "../core/config.js";
import { createProvider } from "../providers/index.js";
import { createApp } from "./app.js";
import { SqliteStore } from "../storage/sqlite-store.js";
import { buildPolicy } from "../core/services.js";
import { HederaPaymentSigner, UnavailablePaymentSigner } from "../payment/signer.js";
import { PaymentGate } from "../payment/gate.js";
import { SophronAgent } from "../agent/sophron-agent.js";

const config = loadConfig();
const provider = createProvider(config.dataProvider);
const store = new SqliteStore(config.databasePath);
const policy = buildPolicy(config);
let signer;
try {
  signer = HederaPaymentSigner.fromEnvironment();
} catch (error) {
  const reason = error instanceof Error ? error.message : "Hedera signer is unavailable";
  console.warn(`Sophron signer disabled until credentials are configured: ${reason}`);
  signer = new UnavailablePaymentSigner(reason);
}
const gate = new PaymentGate({
  policy,
  store,
  signer,
  serverBaseUrl: config.serverBaseUrl,
});
const agent = new SophronAgent(gate, config.openAiModel);
const app = createApp(provider, config, { store, policy, gate, agent });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Sophron x402 policy server (provider=${provider.id}) listening on :${info.port}`);
});
