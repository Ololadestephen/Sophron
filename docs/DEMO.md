# Sophron demo runbook

The target walkthrough is under three minutes and shows one automatic payment, one policy rejection, and one human-approved payment.

## One-time preparation

1. Use Node.js 20 or newer and run `npm install`.
2. Create `.env` from `.env.example`.
3. Set `PAY_TO_ACCOUNT` to the receiving Hedera testnet account.
4. Set `HEDERA_CLIENT_ID` and `HEDERA_CLIENT_KEY` to a funded ECDSA testnet buyer.
5. Keep `SOPHRON_DEMO_MODE=true` only for this disposable demo.
6. Optionally set `OPENAI_API_KEY` to demonstrate model-driven tool selection.

Never show the private key in the terminal, dashboard, recording, or repository.

## Preflight

Run the full local verification:

```bash
npm run check
```

Then start the API and dashboard in separate terminals:

```bash
npm run dev
```

```bash
npm run web:dev
```

Confirm `http://localhost:4021/health` returns `status: ok` and the dashboard reports that the API is connected.

## Dashboard sequence

1. Click **Reset demo** and point out the 0 settled / 0 reserved budget.
2. Run `risk-report`. It costs 0.01 HBAR, passes policy automatically, reaches `fulfilled`, and displays a HashScan transaction link.
3. Run `unknown-provider`. Its challenge is structurally valid, but the payment destination is outside the allowlist. It reaches `rejected`; show the audit reason and note that the signer was never called.
4. Run `market-brief`. It costs 0.03 HBAR, above the strict 0.02 HBAR approval threshold, so it pauses at `pending_approval` with an active reservation.
5. Open the attempt, show the challenge hash, destination, price, reservation expiry, and audit timeline. Click **Approve**.
6. The gate fetches the challenge again, rechecks policy, signs, settles, and reaches `fulfilled`. Open its HashScan link.
7. Return to the policy panel and show settled spend and remaining daily budget.

At each step, emphasize that the model selected a service, but deterministic code decided whether money could move.

## Scripted fallback

With the API already running, execute:

```bash
npm run demo
```

The script performs and asserts the same three paths. It exits nonzero if the expected state is not reached and prints successful HashScan links.

## Rail-only live check

To isolate the x402/Hedera integration from the policy dashboard:

```bash
E2E_PRODUCT=risk-report npm run e2e
```

Expected evidence:

- the first request returns HTTP 402 and a Hedera payment requirement;
- the client signs with the configured ECDSA buyer;
- the retry returns HTTP 200 and `payment-response`;
- the decoded response includes a Hedera transaction ID visible on HashScan testnet.

## Troubleshooting

| Symptom | Check |
|---|---|
| Signer disabled warning | Both buyer credential variables are present and the private key is ECDSA. |
| Payment fails for insufficient balance | Fund the buyer on Hedera testnet and retry with a new challenge. |
| Reset returns 403 | Set `SOPHRON_DEMO_MODE=true` and restart the API. |
| Dashboard says API unavailable | Confirm `SERVER_URL`, API port 4021, and frontend API base URL agree. |
| Approval immediately fails | The 15-minute reservation or x402 challenge may have expired; start a new attempt. |
| HashScan does not load immediately | Wait briefly for testnet indexing, then refresh the transaction URL. |
| Agent does not use a model | Set `OPENAI_API_KEY`; the no-key path deliberately runs the HAK tool directly. |

## Evidence to capture for submission

- terminal output from `npm run check`;
- the real initial 402 challenge;
- a rejected unknown-merchant audit timeline;
- a pending approval and its reservation;
- successful automatic and approved purchase receipts;
- both HashScan transaction pages;
- dependency versions showing HAK v4 and x402 exact pins;
- architecture and threat-model documents.
