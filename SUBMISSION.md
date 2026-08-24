# Razorpay AI Buildathon submission pack

## Track

**03 — AI Revenue Recovery**

## Project name

**RecoverFlow — an AI Revenue Recovery Control Plane**

## What it solves

Merchants lose revenue when payments fail, checkouts are abandoned, mandates expire, or invoices become overdue. Generic retries and bulk reminders can create duplicate charges, contact customers without consent, or waste recovery opportunities.

RecoverFlow turns a payment failure into a safe recovery workflow: it diagnoses the likely cause, explains the evidence, applies non-negotiable policy rules, asks for human approval, and records the outcome in a tamper-evident audit chain.

## One-line pitch

**AI can diagnose a payment failure, but it should not move money autonomously. RecoverFlow turns failure webhooks into evidence-backed, policy-bounded recovery actions.**

## Architecture summary

1. Razorpay Test Mode sends a signed `payment.failed` webhook.
2. RecoverFlow verifies the HMAC signature and rejects forged events.
3. The diagnosis engine classifies the failure and assigns confidence.
4. The policy engine checks consent, retry limits, duplicate/dispute risk, confidence, and value thresholds.
5. Only policy-eligible cases receive a human-approved recovery action.
6. The audit service hash-links every backend decision; webhook idempotency prevents duplicate recovery actions.

## AI judgment

AI/model reasoning belongs in diagnosis and recovery-message drafting, where ambiguity exists. Deterministic policy remains the authority for financial actions. This avoids treating fluent text generation as payment authorization.

## Metrics to show in the video

- Revenue at risk and recovered value
- Recovery rate across the synthetic batch
- Cases protected by policy
- Human-review workload
- Diagnosis confidence
- Audit-chain integrity status
- Held-out scenario-suite results

State clearly that batch outcomes are simulated until the Test Mode proof is run; do not claim synthetic results as live merchant performance.

## What broke, and how we recovered

The first recovery logic treated every payment failure as an eligible retry. That was unsafe: a repeated mandate failure could receive another retry, and a suspected duplicate charge could trigger an inappropriate customer message.

We corrected the design by separating diagnosis from authority. The policy engine now blocks duplicate/dispute signals, retry-limit breaches, missing consent, low-confidence diagnoses, and high-value cases. Blocked cases are retained in the visible exception queue with their evidence instead of being hidden.

## Demo order

1. Introduce the payment-recovery problem in 20 seconds.
2. Show the dashboard’s revenue-at-risk and exception metrics.
3. Run a live Decision Lab case: issuer timeout → bounded recovery recommendation.
4. Open a duplicate-charge case file → show why policy refuses to act.
5. Preview a Hinglish recovery draft for an eligible case → explain no automatic sending.
6. Show the audit chain and webhook idempotency protections.
7. Trigger one Razorpay Test Mode failure after deployment and show it reach RecoverFlow.
8. Close with the one-line pitch.

## Form-answer checklist

- [ ] Your name, college, graduation year
- [ ] Bangalore availability and 6/12-month preference
- [ ] Resume
- [ ] Track: AI Revenue Recovery
- [ ] Project name: RecoverFlow
- [ ] Public GitHub repository URL
- [ ] Unlisted five-minute video URL
- [ ] Deployment URL
- [ ] “What broke” answer above
