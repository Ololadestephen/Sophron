# Sophron threat model

## Scope and assets

This threat model covers the single-operator Hedera testnet MVP. The main assets are the buyer ECDSA private key, testnet HBAR balance, approval authority, remaining daily budget, protected API data, audit history, and payment receipts.

The LLM, user prompt, service descriptions, HTTP challenge, paid resource body, browser, and external facilitator are treated as untrusted inputs. The local backend process and SQLite file are inside the trusted operator boundary.

## Enforced controls

| Threat | Control |
|---|---|
| Prompt injection asks the agent to bypass a limit | The model has no signer or policy configuration. A pure policy function decides every request. |
| Model invents an amount or destination | Amount, asset, network, destination, and expiry are decoded from the resource's x402 challenge. |
| Untrusted merchant returns a valid challenge | Merchant ID, destination account, origin, and catalog resource must all match the allowlist. |
| Request exceeds a single-payment limit | Integer-tinybar maximum check occurs before reservation or signing. |
| Concurrent requests exceed the daily limit | Settled spend and active reservations are checked and reserved in a SQLite transaction. |
| Human approves one request but a different challenge is signed | Approval is bound to a stored challenge hash; the gate fetches and hashes a fresh challenge before signing. |
| Approval becomes stale | The reservation has a short expiry and must still be active at signing time. |
| Rejected or pending attempt reaches the key | Only `PaymentGate.executeAuthorized` calls the signer, after status, reservation, challenge, and policy checks. Tests assert the signer call count remains zero. |
| Key leaks into the model or browser | Only `src/payment/signer.ts` reads `HEDERA_CLIENT_KEY`; no API contract contains key material. `.env` is ignored by Git. |
| Settlement fails after submission | The attempt records `settlement_failed`, stores the error, and releases the reservation. Protected success requires the facilitator response to report a transaction. |
| Audit records are rewritten | SQLite triggers reject updates and deletes of `audit_events`. |
| Demo reset destroys production history | Reset is disabled unless `SOPHRON_DEMO_MODE=true`. |
| An unrelated website reads the local operator API | CORS is restricted to the configured dashboard origin rather than a wildcard. |
| Floating-point rounding changes authorization | All authorization values are validated decimal integer strings and converted to `bigint`. |

## Trust boundaries

### Agent boundary

The agent receives service IDs and textual results. It cannot import the signer implementation, supply arbitrary payment requirements, or call a raw transfer tool. The HAK plugin exposes only `purchase_service`.

### Signer boundary

The signer accepts the verified raw `payment-required` header. It does not accept free-form amount or destination fields from the model. Signed payment payloads are short-lived secrets and are not written to audit metadata.

### Facilitator boundary

Blocky402 is trusted to verify the signature, pay Hedera fees, settle, and report the transaction accurately. Sophron retains the transaction ID for independent HashScan inspection. A dishonest or unavailable facilitator can deny service or misreport status; this MVP does not run an independent mirror-node confirmation before returning the result.

### Browser boundary

The dashboard is an operator console, not a public multi-user application. Approval and denial routes currently assume a trusted local origin. Before public deployment, place the control API behind authenticated server-side sessions, restrict CORS, and add CSRF protection. Do not ship a bearer secret in browser JavaScript.

## Residual risks

- The MVP keeps the buyer key in backend process environment rather than an HSM, KMS, or separate signer service.
- SQLite and its append-only triggers do not protect against an administrator replacing or deleting the database file.
- A crash can occur after Hedera settlement but before local receipt persistence. Reconciliation against a mirror node is not implemented.
- Retrying an ambiguous submission may risk duplicate payment unless the facilitator provides conclusive idempotency. The gate prevents an already terminal local attempt from being approved twice, but it cannot recover every cross-system crash window.
- The hosted facilitator and Hedera network are external availability dependencies.
- Demo data is not a real risk, market, credit, security, or compliance assessment.
- A public deployment needs authentication, authorization, CSRF protection, request throttling, encrypted secret custody, backups, monitoring, and incident procedures.

## Secret handling checklist

- Use a funded ECDSA **testnet** account only.
- Put credentials only in local `.env` or the deployment secret manager.
- Never prefix the private key with a frontend-public environment convention.
- Never paste the key into a prompt, issue, screenshot, or demo recording.
- Do not log `payment-signature`, raw signed transaction bytes, or environment values.
- Rotate the testnet key if it is exposed and fund demo accounts only with the minimum useful balance.
