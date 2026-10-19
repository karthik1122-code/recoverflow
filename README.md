# RecoverFlow

**Hear your failed Razorpay payments come back.** RecoverFlow reads every failed payment, explains why it failed in plain words, and sends that customer one Razorpay payment link when someone on your team approves it. When the customer pays, the case closes itself and the money shows in a weekly report.

Pricing for stores: free for 30 days, then 8% of what comes back, nothing if nothing does.

[![Verify](https://github.com/karthik1122-code/recoverflow/actions/workflows/verify.yml/badge.svg)](https://github.com/karthik1122-code/recoverflow/actions/workflows/verify.yml)

![The soundbox on the landing page](docs/landing.png)

| One case, scroll by scroll | On a phone |
|---|---|
| ![Story](docs/story.png) | ![Mobile](docs/mobile.png) |

| Inbox | A recovered case |
|---|---|
| ![Inbox](docs/dashboard-light.png) | ![Recovered case](docs/case.png) |

![Dashboard in dark mode](docs/dashboard-dark.png)

## Run it

```bash
npm ci
DEMO=on AUTH=off npm run dev     # sample stores, simulated links, no keys needed
npm test                         # 100 tests; set TEST_DATABASE_URL* to also run the Postgres ones
npm run test:ui                  # browser tests (Playwright + Chromium)
npm run build:preview            # server-free preview in dist-preview/
```

Open `http://localhost:4173` for the site and `/app.html` for the dashboard. In the demo, approve a case, then press **Simulate customer paying** to see the full loop.

For a real store, see [DEPLOY.md](DEPLOY.md). Selling it: [docs/SALES.md](docs/SALES.md).

## Product

| Page | What it does |
|---|---|
| Needs approval | Failed payments the safety rules allow you to follow up, with the reason, the evidence and the exact message the customer will get |
| Waiting for payment | Links that are out; cases close by themselves on `payment_link.paid` |
| Recovered | Money that came back, with who approved it |
| Held by safety rules | Duplicates, disputes, no-consent and unclear failures, never contacted automatically |
| Weekly report | Recovered amount, links sent, why payments failed; prints to PDF for the store owner |
| Audit trail | Hash-chained log of every webhook, approval and payment |
| Connect Razorpay | Webhook URL, events to tick, key status, and a signed test failure button |

## Accounts and roles

Sign-in is on by default. The first visit to `/login.html` shows a setup screen that creates the administrator; set `SETUP_TOKEN` before deploying so a stranger who finds the URL first cannot claim that account. Administrators add people at `/team.html`.

| Role | Can do |
|---|---|
| viewer | read the dashboard, metrics and audit trail |
| approver | also run diagnoses and draft messages |
| admin | also manage people and create test payment links |

`POST /webhooks/razorpay` never needs a session; it is protected by the Razorpay signature. Passwords use scrypt, sessions are random tokens stored only as SHA-256 hashes, cookies are `HttpOnly; SameSite=Strict`, writes under `/api` need a custom `x-ag-csrf` header, and repeated failed logins lock that email and address for 15 minutes. `AUTH=off` serves the synthetic demo with no sign-in (used for the public showcase); never use it with real data.

Limits: email and password only, with no verification email, password reset, SSO or two-factor yet; login throttling is in memory and resets on restart.

## Recovery loop (real webhooks, real money)

Every signed `payment.failed` / `subscription.*` webhook becomes a **case**. The policy engine decides whether it is `open` (a human may act) or `held` (never actioned automatically).

```
open ──approve──► approving ──► link_sent ──payment_link.paid──► recovered
  │                  └─ Razorpay error ─► open (nothing sent)   └─ payment_link.expired ─► expired
  └──dismiss──► dismissed            held ──dismiss──► dismissed
```

- **Approve** (`POST /api/cases/:id/approve`, approver role) creates one Razorpay payment link for the failed amount. Razorpay itself texts and emails the customer, so no WhatsApp or email provider is needed yet.
- **Paid** — add `payment_link.paid` and `payment_link.expired` to the webhook's events in the Razorpay dashboard. The link carries `notes.rf_case`, so the payment lands on the right case and the dashboard shows money actually recovered, not a simulation.
- **Exactly once** — approval first *claims* the case in a transaction (`open → approving`), then calls Razorpay. Ten simultaneous clicks create one link; a Razorpay failure releases the claim; redelivered paid events change nothing.
- **Safe by default** — `rzp_live_` keys are refused unless `RAZORPAY_MODE=live` is set. Viewers see masked contacts (`•••3210`).
- `GET /api/cases` returns every case plus a value-weighted summary: at risk, in flight, recovered and recovery rate.

- **Crash safe** — if the server dies between claiming a case and Razorpay answering, a sweeper asks Razorpay for a link with reference `rf_<payment id>` after 10 minutes: found means the case is marked sent, not found means it is released. Nothing is ever guessed.

## Why this matters

Revenue loss is rarely a single failure: a payment can time out after OTP, a subscription mandate can fail, a B2B invoice can go overdue, or an otherwise high-intent checkout can be abandoned. Generic retries and mass reminders waste customer trust. RecoverFlow chooses the *least intrusive action that is justified by evidence*.

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

## What broke, and how we handled it

Initially, the recovery logic treated any payment failure as a retry candidate. That would have retried a failed mandate repeatedly and may have contacted customers with a suspected duplicate charge. We added a policy engine that blocks retry-limit breaches, low-confidence diagnoses, and duplicate/dispute signals. Held cases now remain visible in the exception queue instead of being silently dropped.

## Evaluation

`npm run evaluate` runs a fixed 21-record synthetic **held-out scenario** suite covering transient failures, insufficient funds, mandates, duplicates, retry limits, unknown errors, and consent refusal. It reports diagnosis accuracy, policy-assertion accuracy, approval/hold counts, and a clearly labelled conservative recovery simulation. This is regression coverage, **not** a claim of live merchant performance.

### Hard set (stress test)

`npm run evaluate:hard` runs 47 hand-written cases with paraphrases, typos, Hinglish, refund messages, conflicting signals, consent and the high-value boundary. It prints per-class precision and recall, a confusion matrix and every miss. The cases were written by the author, so this is a stress and regression set, not production data.

| | First run | After rule fixes |
|---|---|---|
| Diagnosis accuracy | 72.3% (34/47) | 97.9% (46/47) |
| Unsafe actions (a case that must be held got queued for a customer) | 2 | 0 |

What the first run found: the pattern `fund` matched "Refund processed" and "Funds transfer reversal", so the engine would have queued a payment reminder for a refund. Other misses were paraphrases ("not responding", "timed out", "not enough money"). The fixes were word-aware patterns and an explicit refund/reversal guard. The one remaining miss is intentional: "Refund initiated; original card has expired" is held for a human. The accuracy figure was measured on the same cases used to fix the rules, so treat it as a regression gate, not a prediction of live accuracy. CI fails if an unsafe action appears or accuracy drops under 95%.

## Quality bar

- `npm test` validates core safety rules.
- `npm run evaluate` produces reproducible benchmark output.
- GitHub Actions runs both checks on every push.
- The only runtime dependency is `pg`, and it is loaded only when `DATABASE_URL` is set. Without it the app runs in memory with zero dependencies.

## Deployment

The repository includes a Render blueprint and a step-by-step [deployment runbook](DEPLOY.md). It deploys the webhook receiver over HTTPS while keeping Test Mode secrets in the host's environment-variable store.

## Project layout

```
server.mjs        HTTP server: API, webhook receiver, static files (public/ only)
core.mjs          diagnose() + policyDecision(); HIGH_VALUE_PAISE = 50_000_000 (₹5,00,000)
webhook.mjs       HMAC verification + Razorpay payload evaluation
audit.mjs         hash-chained audit log      idempotency.mjs  stable event keys
metrics.mjs       process counters behind /api/metrics
store.mjs         in-memory store: atomic webhook commit (claim + record + audit, or nothing)
pg-store.mjs      same contract on Postgres, one transaction per webhook
messages.mjs      consent-safe message drafts (English / Hinglish)
cases.mjs         recovery case state machine + value-weighted summary
razorpay.mjs      payment link client, reference lookup, simulated provider for the demo
sweeper.mjs       finishes or releases approvals left half-done by a crash
report.mjs        weekly "we got you ₹X back" numbers
demo.mjs          synthetic Razorpay payloads for the demo and the test button
public/           index.html (site) + app.html (dashboard), tokens.css design system; the only directory served
```

Amounts are always integers in **paise**.

## UI

Chosen after two studies ([docs/DESIGN_STUDY.md](docs/DESIGN_STUDY.md)): 109 SaaS and fintech sites, then 108 award-winning sites from any industry.

**The soundbox.** The most recognisable object in Indian retail is the UPI speaker on the counter that says "₹2,499 received". RecoverFlow announces money that came back, so the site is a soundbox you press: a failed payment slides in, the link goes out, and the box chimes and says the amount out loud (Web Audio chime + speech, only after a press, with a sound toggle). The speaker is drawn in CSS from scratch and carries no brand.

- **Site:** the soundbox on a dark counter with an LCD that boots, a pinned scroll story that walks one case through four steps, the two-week "green inside red" chart, a calculator, 8% pricing with the founder's pilot letter, and the name as a full-width wordmark.
- **Dashboard:** greeting that leads with what is waiting, 14-day recovered trend, reason filter chips, multi-select with a bulk "send links" bar, Ctrl/⌘ K palette, J/K/X/A/slash/? shortcuts, and the same soundbox chime when a case is recovered.
- Marigold `#F4A51C` and ink `#131A33`; Newsreader for display, Geist for interface, VT323 only on the LCD. Light and dark, phone width, visible focus, reduced motion respected (the story turns into a plain list).
- `npm run test:ui` drives both in Chromium: approve, bulk send, palette, report, soundbox press, story steps, and no sideways scrolling at 390px in light and dark.
## Reliability

Webhook handling is built to be safe to retry:

- **Atomic commit.** The idempotency key, the event record and its audit entry are committed together. If processing fails part-way, the key is released and nothing is recorded, so the sender's retry is processed normally.
- **Concurrent duplicates.** Duplicates that arrive while the first attempt is still running are not processed twice. Tests fire 200 simultaneous deliveries at the store and 50 at the HTTP endpoint and assert exactly one record.
- **No key collisions.** If a payload has no entity id or timestamp, the key falls back to a fingerprint of the raw body, so two different events never share a key.
- **Audit chain after trimming.** When old records are dropped to cap memory, the hash of the last dropped record is kept as a checkpoint, so the retained chain still verifies and tampering is still detected.

### Observability

`GET /api/metrics` returns counters for this running instance (received, accepted, duplicates blocked, signature failures, processing errors), deliveries per minute for the last 30 minutes, the storage backend, and a breakdown of recorded events by diagnosis and policy code. The dashboard shows the same data in the Webhook health card. Counters live in memory and reset on restart; the events and audit chain are what persist.

### Persistence

Set `DATABASE_URL` and the server uses Postgres; leave it unset and it runs in memory (state resets on restart).

- The idempotency key is a primary key. The key, event and audit record are inserted in a single transaction, so a crash leaves nothing half-written.
- A duplicate that arrives while the first attempt is still running waits on the unique index. If the first attempt commits, the duplicate is dropped; if it rolls back, the duplicate is processed. The database enforces this, not application code.
- Audit appends are serialised with an advisory lock, so two writers can never link to the same previous hash.
- `GET /api/audit` returns the latest 500 records plus an anchor hash, so the window still verifies.
- Tests in `pg-store.test.mjs` run against a real database when `TEST_DATABASE_URL` is set (skipped otherwise): 200 concurrent duplicates, rollback and retry, a duplicate racing a failing attempt, restart persistence, and tamper detection on a window.

## Security notes

- Only `public/` is served; source files, `.env` and the audit file are never reachable.
- Strict CSP and security headers; request bodies capped at 100 KB; in-memory records capped at 500.
- Webhooks require a valid `X-Razorpay-Signature`; duplicates are ignored.
- `POST /api/create-test-payment-link` is **off by default**. Set `ENABLE_TEST_LINKS=true` on a private deployment; only `rzp_test_` keys are accepted and the amount is clamped.
- If an earlier version of this server was ever deployed publicly with a `.env`, rotate those Test Mode secrets.

## Local development

The HTTP server uses Node's built-in modules. Run `npm ci` once to install `pg`; it is only used when `DATABASE_URL` is set:

```bash
cd recoverflow
npm test          # unit + server integration tests
npm run evaluate  # synthetic held-out scenario suite
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
