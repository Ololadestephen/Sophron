# Sophron architecture

## Design rule

The model may express intent and choose a service. It cannot choose the payment amount, destination, network, approval outcome, or signature. Those values come from a verified x402 challenge and deterministic code.

## Runtime flow

1. `SophronAgent` exposes one HAK v4 `BaseTool`: `purchase_service`.
2. `PaymentGate` resolves the selected ID against the static candidate catalog and sends an unpaid request.
3. The resource server returns `402 Payment Required` with a `payment-required` header.
4. The gate base64-decodes the exact header bytes, hashes them with SHA-256, and normalizes the Hedera payment requirement.
5. The pure policy engine validates merchant ID plus destination, origin/resource, testnet HBAR asset, per-request maximum, and UTC-day budget.
6. SQLite creates the reservation and workflow transition in a transaction. A low-cost request becomes `authorized`; a higher-cost request becomes `pending_approval`; a hard failure becomes `rejected`.
7. Approval is bound to the stored challenge and reservation. Immediately before signing, the gate fetches a fresh challenge and rechecks its hash and every policy rule.
8. Only then can the gate call `HederaPaymentSigner`, which reads the ECDSA key from process environment and creates the `payment-signature` header.
9. The paid retry reaches the x402 middleware. Hosted Blocky402 verifies and settles the HBAR payment on Hedera testnet.
10. Sophron requires a successful `payment-response`, stores its transaction ID, builds a HashScan link, consumes the reservation, and returns the protected response.

## Module boundaries

| Module | Responsibility | Must not do |
|---|---|---|
| `src/agent` | service intent and HAK tool invocation | read keys or authorize money |
| `src/policy` | pure decision over policy, intent, and spend | perform I/O or sign |
| `src/payment/challenge.ts` | decode, normalize, and hash x402 challenge | trust agent-provided amounts |
| `src/payment/gate.ts` | state machine, policy orchestration, signer access | expose signature/key to browser or model |
| `src/payment/signer.ts` | construct the Hedera payment signature | select merchants or bypass policy |
| `src/storage` | atomic reservations, audit events, receipts | make policy decisions |
| `src/server` | resources and dashboard HTTP contract | embed buyer credentials |

The TypeScript import graph reinforces these boundaries: the agent depends on the gate interface, while only the server composition root constructs the concrete signer.

## State machine

```text
challenged -> rejected
           -> pending_approval -> denied
                               -> authorized
           -> authorized -> signing -> submitted -> settled -> fulfilled
                                      \-> settlement_failed
```

Signing, paid-request, or settlement errors end in `settlement_failed` and release the budget reservation.

## Budget consistency

The daily limit counts successful transaction-bearing attempts plus active reservations. Reservations are created for both automatic and approval-gated paths, expire after 15 minutes by default, and are released on denial or terminal failure. This prevents two concurrent purchases from each seeing the same remaining balance.

SQLite runs in WAL mode. Reservation calculation and insertion execute inside a database transaction. Audit events are protected by triggers against update and deletion; mutable attempt rows are a materialized workflow view rather than the audit source of truth.

## Receipt identity

`challengeHash` is SHA-256 of the bytes produced by base64-decoding the exact `payment-required` header. It binds approval, revalidation, signing, and the receipt to the same challenge.

The local receipt contains:

- attempt and challenge identity;
- Hedera transaction ID and network;
- payer when supplied by the facilitator;
- amount, merchant, and protected resource;
- a deterministic SHA-256 receipt hash.

The dashboard exposes the transaction through the attempt and links to HashScan. HCS anchoring is intentionally a stretch feature, not part of the payment-critical path.

## External dependencies

- Hosted Blocky402 is the facilitator and fee payer for the submission path.
- Hedera testnet is the settlement network.
- OpenAI is optional and used only for service intent when configured.
- The application still works without a model key through the constrained HAK tool runner.

The resource server owns no buyer or facilitator key. The buyer key exists only in the backend signer process.
