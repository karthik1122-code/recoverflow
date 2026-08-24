# Architecture decision record

## The decision

RecoverFlow separates **probabilistic intelligence** from **deterministic authority**.

An AI/model layer may identify a likely failure class, summarize evidence, and propose a next-best action. It never authorizes a payment, retries a mandate, sends a customer communication, or suppresses an exception. A policy engine controls those operations.

## Why it matters

Payment recovery is a financial workflow. A fluent model response is not evidence that an action is correct, compliant, consented to, or safe. The policy layer makes the decision inspectable and repeatable.

## Components

| Component | Responsibility | Failure behaviour |
|---|---|---|
| Razorpay webhook ingress | Verifies HMAC and normalizes failure event | Reject invalid signature; record no event |
| Diagnosis layer | Returns structured cause, confidence, evidence | Low confidence routes to hold |
| Policy engine | Enforces consent, retry, dispute, amount, confidence rules | Holds exception; never sends action |
| Approval gate | Confirms a single bounded intervention | No approval means no execution |
| Recovery executor | Creates test-mode Payment Link / safe draft action | Idempotency key and immutable audit event |
| Audit store | Retains source event, rationale, policy result, outcome | Exportable JSON for review |

## Threat model highlights

- Forged webhook → prevented by HMAC signature verification.
- Prompt injection through payment notes → notes are evidence only; they never override policy.
- Repeated retries → explicit 24-hour retry ceiling.
- Customer harassment → no outbound message without opt-in; one action per case.
- Unapproved outreach → the message service only drafts communications for policy-eligible records; no endpoint sends a message.
- Duplicate/disputed charge → hard-stop to human review.
- API-key exposure → credentials exist only in server environment variables, never frontend code.
- Silent audit alteration → every backend audit record is hash-linked to its predecessor; verification detects modified records or broken links.
- Webhook redelivery → an immutable event key is claimed once, preventing duplicate recovery cases or duplicate customer actions.

## Production evolution

1. Persist webhook idempotency keys and audit events in Postgres.
2. Add a queue for rate-limited, retried recovery jobs.
3. Put a calibrated classifier beside structured LLM extraction.
4. Measure incremental recovery against an ethically configured holdout/control group.
5. Use a merchant-configurable approval policy with RBAC.
