# RecoverFlow

**A policy-first AI revenue recovery agent for Razorpay AI Buildathon — Track 03: AI Revenue Recovery.**

RecoverFlow finds revenue at risk, diagnoses the probable cause from payment and customer-intent signals, recommends one bounded recovery action, and preserves an audit trail for every decision.

## Why this matters

Revenue loss is rarely a single failure: a payment can time out after OTP, a subscription mandate can fail, a B2B invoice can go overdue, or an otherwise high-intent checkout can be abandoned. Generic retries and mass reminders waste customer trust. RecoverFlow chooses the *least intrusive action that is justified by evidence*.

## Demo

Run the local app, then press **Run recovery sweep**. Review any intervention and approve it to see the recovered-value metric and immutable decision trail update.

No network, credentials, or real payment data are used. The app ships with deliberately synthetic payment records.

## System design

```
Payment / checkout events
        ↓
Signal normalizer → diagnosis model → policy engine → human approval gate
        ↓                                      ↓
  evidence + confidence                    audit event
        ↓
bounded recovery executor → outcome measurement
```

### AI boundary

The agent may classify a cause and draft an intervention, but it does **not** execute money-impacting actions autonomously. A deterministic policy layer checks confidence, consent, retry limits, dispute/duplicate flags, and amount thresholds before presenting an action for approval.

In production, the diagnosis stage can use an LLM with structured JSON output plus a calibrated classifier. This prototype keeps its rules and synthetic data visible for a reproducible, explainable demo.

## Guardrails

- At most one retry within 24 hours.
- No customer contact after opt-out.
- No automatic payment, refund, or retry execution.
- Duplicate-charge and low-confidence cases are held for a human.
- Every decision includes source evidence and its policy result.

## Metrics shown

- Revenue at risk and recovered amount
- Recovery rate across the batch
- AI confidence on eligible recommendations
- Actions withheld by policy
- Evidence coverage

## What broke, and how we handled it

Initially, the recovery logic treated any payment failure as a retry candidate. That would have retried a failed mandate repeatedly and may have contacted customers with a suspected duplicate charge. We added a policy engine that blocks retry-limit breaches, low-confidence diagnoses, and duplicate/dispute signals. Held cases now remain visible in the exception queue instead of being silently dropped.

## Buildathon submission checklist

- [ ] Publish this directory as a public GitHub repository.
- [ ] Add a short screen recording / deployment link to this README.
- [ ] Record a five-minute pitch: problem → live sweep → approval gate → metrics → architecture → failure recovery.
- [ ] Replace the synthetic-demo outcome label with a real test-mode integration only if you can validate it end-to-end.

## Evaluation

`npm run evaluate` runs a fixed 21-record synthetic **held-out scenario** suite covering transient failures, insufficient funds, mandates, duplicates, retry limits, unknown errors, and consent refusal. It reports diagnosis accuracy, policy-assertion accuracy, approval/hold counts, and a clearly labelled conservative recovery simulation. This is regression coverage, **not** a claim of live merchant performance.

## Quality bar

- `npm test` validates core safety rules.
- `npm run evaluate` produces reproducible benchmark output.
- GitHub Actions runs both checks on every push.
- The included Dockerfile deploys without third-party runtime dependencies.

## Deployment

The repository includes a Render blueprint and a step-by-step [deployment runbook](DEPLOY.md). It deploys the webhook receiver over HTTPS while keeping Test Mode secrets in the host's environment-variable store.

## Buildathon application

Use [SUBMISSION.md](SUBMISSION.md) for the form answers and five-minute demo flow.

## Local development

This is intentionally dependency-free and uses Node's built-in HTTP server:

```bash
cd recoverflow
npm test
npm run dev
```

Open `http://localhost:4173`.

### Razorpay test-mode proof

The optional integration server verifies the `X-Razorpay-Signature` HMAC before accepting `payment.failed`, `subscription.pending`, or `subscription.halted` webhooks. It also has a server-only endpoint for generating a **Test Mode** Payment Link; credentials stay in `.env` and never reach the browser.

1. Copy `.env.example` to `.env` and add Test Mode credentials only. The local `.env` file is excluded from Git.
2. Start the app with `npm run dev`; it loads `.env` automatically when present.
3. Expose your local server with a public HTTPS tunnel and configure its `/webhooks/razorpay` endpoint in the Razorpay Test Mode Dashboard.
4. Create a test Payment Link and select a test failure. The signed webhook becomes an evaluated RecoverFlow record.

Razorpay documents that `payment.failed` webhooks are the correct server-side signal for failed payment automation, distinct from a client callback. Test Mode Payment Links explicitly support choosing a success or failure flow. [Payment webhooks](https://razorpay.com/docs/webhooks/payments/) · [Test-mode Payment Links](https://razorpay.com/docs/payments/payment-links/create/)
