# Sophron

**A deterministic policy plane for AI-agent payments over x402 on Hedera.**

Sophron lets an agent choose and purchase paid API services, while application code—not the model—controls merchant trust, per-request limits, daily spend, approvals, signing, and receipts.

The bounty demo proves three paths:

- an allowlisted 0.01 HBAR purchase settles automatically;
- a 0.03 HBAR purchase pauses for human approval before signing;
- a valid x402 challenge from an unknown merchant is rejected before the signer runs.

## How it works

```text
prompt -> Hedera Agent Kit purchase_service tool -> unpaid resource request
                                                   |
                                                   v
                                           x402 Payment Required
                                                   |
                                                   v
SQLite reservation <- deterministic policy <- normalized challenge
        |                                          |
        | reject / await approval                  | authorize
        v                                          v
  audit trail                               isolated ECDSA signer
                                                   |
                                                   v
                                  paid retry -> Blocky402 -> Hedera
                                                   |
                                                   v
                                     protected result + receipt
```

The payment gate performs the exact two-request x402 flow. It hashes and stores the original challenge, reserves budget atomically, rechecks the complete policy immediately before signing, and persists the Hedera transaction and HashScan link.

See [Architecture](docs/ARCHITECTURE.md) and [Threat model](docs/THREAT_MODEL.md) for the detailed boundaries and invariants.

## Stack

- Node.js 20+, TypeScript, Hono
- x402 `2.16.0` with the Hedera exact scheme
- Hedera Agent Kit `4.0.0` with the LangChain adapter `1.0.0`
- Hiero SDK `2.86.2`
- SQLite in WAL mode
- hosted Blocky402 testnet facilitator
- Astro dashboard in `web/`

The key integration versions are exact-pinned in `package.json`.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   ```dotenv
   PAY_TO_ACCOUNT=0.0.<seller-account>
   HEDERA_CLIENT_ID=0.0.<funded-ecdsa-buyer>
   HEDERA_CLIENT_KEY=<ecdsa-private-key>
   ```

   Use a funded **ECDSA Hedera testnet** buyer account. Never place the key in frontend variables, prompts, logs, or committed files.

3. Start the API:

   ```bash
   npm run dev
   ```

4. In another terminal, start the dashboard:

   ```bash
   npm run web:dev
   ```

5. Open the URL printed by Astro. For a deterministic terminal walkthrough instead, run:

   ```bash
   npm run demo
   ```

The web root is Sophron's cinematic product story. Open `/dashboard` for the interactive control plane.

`OPENAI_API_KEY` is optional. When configured, the HAK/LangChain agent selects and calls `purchase_service`. Without it, the same HAK v4 `BaseTool` runs directly with a deterministic service-selection fallback; policy and signing behavior are identical.

For the raw rail-only check, `npm run e2e` performs a single live `402 -> sign -> settle -> 200` purchase.

## Default policy and services

All monetary policy values are integer tinybar strings. No floating-point arithmetic is used for authorization.

| Rule | Default |
|---|---:|
| Maximum per request | 0.05 HBAR |
| UTC calendar-day limit | 0.1 HBAR |
| Human approval required above | 0.02 HBAR |
| Reservation lifetime | 15 minutes |

| Service | Merchant | Price | Expected outcome |
|---|---|---:|---|
| `risk-report` | `sophron-demo` | 0.01 HBAR | automatic |
| `market-brief` | `sophron-demo` | 0.03 HBAR | pending approval |
| `unknown-provider` | untrusted fixture | 0.005 HBAR | rejected |

The returned reports are deterministic demo data, not financial, credit, security, or compliance advice.

## Dashboard API

The contract shared with the frontend lives in `src/core/contracts.ts`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/policy` | policy and current UTC-day spend |
| `GET` | `/api/attempts` | newest payment attempts |
| `GET` | `/api/attempts/:id` | attempt plus append-only audit events |
| `POST` | `/api/attempts/:id/approve` | authorize and continue one bound challenge |
| `POST` | `/api/attempts/:id/deny` | deny and release its reservation |
| `POST` | `/api/agent/run` | ask the agent to evaluate a purchase |
| `POST` | `/api/demo/reset` | clear disposable demo data when demo mode is enabled |

`SOPHRON_DEMO_MODE=true` enables the destructive reset endpoint. It defaults to disabled and should remain disabled outside a disposable local demo.
Browser CORS is restricted to `SOPHRON_DASHBOARD_ORIGIN`, which defaults to Astro's local `http://localhost:4321` origin.

## Verify

```bash
npm run typecheck
npm test
npm run check
```

The tests cover policy boundaries, malformed amounts, budget reservations, append-only audit records, signing isolation, approval/denial, mocked x402 settlement, API contracts, and the constrained HAK v4 tool.

The complete live-test checklist and demo order are in [Demo guide](docs/DEMO.md).

## Project map

```text
src/agent/       constrained Hedera Agent Kit tool and optional model loop
src/payment/     challenge normalization, isolated signer, payment gate
src/policy/      pure deterministic policy evaluator
src/storage/     SQLite workflow state, reservations, events, receipts
src/server/      Hono resource server and dashboard API
src/providers/   deterministic paid demo resources
scripts/         live rail test and three-scenario demo
web/             dashboard
docs/            architecture, threat model, demo runbook
```

## Current scope

This is a testnet, single-operator bounty MVP. It intentionally excludes mainnet, multi-user roles, merchant onboarding, refunds, disputes, and production custody. The browser control API is designed for a trusted local demo; add authentication and CSRF protection before exposing approvals on a public deployment.

## Acknowledgments

Sophron builds on the x402 protocol and its Hedera packages, the Hedera Agent Kit, the Hiero SDK, the hosted Blocky402 testnet facilitator, and the `matevszm/x402-hedera-example` reference implementation.

## License

Released under the [MIT License](LICENSE).
