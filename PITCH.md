# Five-minute Buildathon pitch — RecoverFlow

## 0:00–0:35 — Problem

“A failed payment is not a dead end. It can be an issuer timeout, an insufficient balance, a failed mandate, an abandoned checkout, or a B2B invoice that needs escalation. Today, merchants often treat all of those cases the same: retry blindly or send generic reminders. That loses revenue and can damage trust.”

“I built RecoverFlow, a policy-first AI recovery agent. It identifies money at risk, diagnoses the likely cause using payment and intent signals, and recommends one safe recovery action—with a human approval gate before anything that could affect money or contact a customer.”

## 0:35–2:00 — Demonstrate the working product

1. Open the dashboard and point at **Revenue at risk**.
2. Press **Run recovery sweep**.
3. Say: “This batch has multiple failure types. The agent found six actionable or exceptional cases, rather than treating them as one queue.”
4. Show the priority queue and the top loss driver.
5. Open Mira Patel’s payment. Explain the visible evidence: issuer timeout, previous successful UPI payments, and still-active customer intent.

## 2:00–3:05 — Show the safety boundary

“The important thing is what RecoverFlow does *not* do. It does not retry automatically. It is limited to one recommended action, shows its evidence, and requires a human approval.”

1. Approve Mira’s action.
2. Point out the recovered metric and audit entry updating.
3. Show Kavya Iyer and Nora Collective. Say: “These are held: one hit the retry limit and the other could be a duplicate charge with low confidence. The agent preserves these exceptions rather than creating harm.”

## 3:05–4:10 — Architecture and AI judgment

“The flow is: payment and checkout signals enter a normalizer; the diagnosis stage assigns a likely cause and confidence; a deterministic policy engine applies consent, retry, dispute, and confidence rules; only then does a human see a bounded action. The outcome is recorded as an auditable event.”

“This separation is intentional. An LLM can help interpret unstructured evidence and draft a customer-appropriate message, but a model must not decide whether money moves. In a production version, diagnosis would use structured LLM output alongside a calibrated classifier; the policy engine remains deterministic.”

## 4:10–5:00 — Metrics and failure recovery

“The dashboard measures revenue at risk, recovered value, recovery rate, confidence, policy-held cases, and evidence coverage. Every recommendation has an explicit evidence record.”

“My first version treated every failure as retryable. During testing, that would have retried a failing mandate repeatedly and could have contacted a customer about a suspected duplicate payment. I corrected it by adding explicit stop rules: one retry per 24 hours, consent enforcement, and automatic holds for duplicate/dispute signals or low confidence.”

“RecoverFlow’s thesis is simple: recovery automation should increase recovered money while making the merchant safer, not less accountable.”
