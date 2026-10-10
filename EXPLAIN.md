# EXPLAIN.md: RecoverFlow, for the person who built it

Read this out loud before every interview. If you cannot explain a section without looking, go and read the file it names.

## The 30-second version

RecoverFlow receives Razorpay payment-failure webhooks, works out why the payment probably failed, and proposes at most one recovery action. A rules layer decides whether that action is even allowed, and a human approves it. Every decision is written to a tamper-evident audit log. The hard part is not the diagnosis. It is that webhooks are delivered more than once and can arrive at the same time, so the system has to be safe to retry.

## The 2-minute version

1. Razorpay sends a signed `POST /webhooks/razorpay`. The server checks the HMAC signature against the raw body first. A forged request gets 401 and nothing else happens (`webhook.mjs`).
2. It derives an idempotency key from the event type, entity id and timestamp (`idempotency.mjs`). A retried delivery has the same body, so it gets the same key.
3. `commitWebhook(key, build)` runs inside one database transaction (`pg-store.mjs`). The key is inserted as a primary key. If it already exists, this is a duplicate and we return 200 without doing anything. Otherwise the event is diagnosed, the event row is inserted, and a hash-chained audit record is appended. All of it commits together or none of it does.
4. `diagnose()` labels the failure (timeout, insufficient funds, expired card or mandate, duplicate, dispute, retry limit, unknown). `policyDecision()` then decides whether any action is allowed: no consent, high value, low confidence, or a failure type that is never auto-actioned all go to a human queue (`core.mjs`).
5. The dashboard shows the queue, the live feed, the audit-chain check and the webhook health numbers.

## Architecture

```
Razorpay -> POST /webhooks/razorpay
              |
        verify HMAC (timing-safe)  --bad--> 401
              |
        idempotency key (event:entity:time, or body fingerprint)
              |
        BEGIN
          INSERT key  --conflict--> ROLLBACK, reply {duplicate:true}
          diagnose -> policyDecision
          INSERT event
          append audit record (advisory lock, links to previous hash)
        COMMIT   (any error -> ROLLBACK, key released, sender retries)
              |
        GET /api/audit, /api/metrics  -> dashboard
```

Storage is a small contract (`commitWebhook`, `addAudit`, `snapshot`) with two implementations: in memory (`store.mjs`) and Postgres (`pg-store.mjs`). `DATABASE_URL` picks one.

## Decisions and why

| Decision | Why | Trade-off |
|---|---|---|
| Verify the signature on the raw bytes before parsing | The signature is computed over the exact body. Re-serialising JSON can change it. | Must read the body once and keep the buffer. |
| Timing-safe comparison | A normal `===` can leak how many characters matched. | Slightly more code. |
| Idempotency key as a database primary key | The database, not application code, guarantees "once". It holds even with many server instances. | Keys table grows, so it needs a cleanup job in a long-running deployment. |
| Key, event and audit in one transaction | A crash between "mark as seen" and "save the event" would lose the event forever, because the retry would be treated as a duplicate. | Slightly longer transactions. |
| Release the key on failure | Returning an error makes Razorpay retry, and the retry must be processed. | None worth noting. |
| Fall back to a body fingerprint when the entity id or timestamp is missing | The earlier version used a shared fallback string, so two different events could collapse into one key. | Two identical bodies still collapse, which is the correct behaviour. |
| Advisory lock on audit appends | Without it, two concurrent writers could both link to the same previous hash and fork the chain. | Audit writes are serialised. At this scale that is fine. |
| Deterministic rules for diagnosis, policy as the final authority | The cause of a payment failure can be explained and tested. An LLM may later suggest a diagnosis, but it must never be allowed to approve a money action. | Rules miss phrasings they have not seen (see below). |
| Missing consent defaults to "no" | A webhook without `notes.recovery_opt_in = "true"` is treated as not consented. Wrong in this direction is safe. | Fewer actions proposed. |
| Money in integer paise | Floating point and money do not mix. | Convert for display. |

## What broke, and how I found out

1. **A failure could lose an event.** The first version marked the idempotency key as seen before doing the work and never released it. If processing failed part-way, Razorpay's retry was treated as a duplicate and the event was gone for good. The fix was one atomic commit of key, event and audit record, with the key released on failure. Tests now fire 200 simultaneous deliveries and a failing attempt followed by a retry.
2. **Key collisions.** When a payload had no entity id or timestamp, every such event shared one fallback key, so a second, different event was silently dropped. Fixed with a fingerprint of the raw body.
3. **Audit chain after trimming.** Keeping only the latest 500 records broke verification, because the oldest kept record pointed at a record that was gone. A new test caught it. The fix is an anchor: the hash of the last dropped record.
4. **Refunds treated as insufficient funds.** The first run of the hard evaluation set scored 72.3% and queued reminders for refund messages, because the pattern `fund` matched "Refund processed". Fixed with word-aware patterns and an explicit refund and reversal guard. After the fix it scored 97.9% with 0 unsafe actions. That figure was measured on the same cases used to fix the rules, so it is a regression gate and not a prediction of live accuracy.
5. **A deployment that would have crashed.** The Dockerfile did not copy `store.mjs`, so the container would have failed on start. Found while adding the Postgres store.
6. **A name collision in the dashboard.** My new metrics function had the same name as an existing one and silently replaced it. The page error showed up in a headless browser check, not in the unit tests, so UI changes need a real browser check.

## Likely interview questions

**1. What happens if the same webhook arrives twice at the same moment?**
Both try to insert the same primary key. One succeeds and holds the row lock, the other waits on the unique index. When the first commits, the second sees the conflict and returns `{duplicate:true}`. If the first rolls back, the second proceeds. I tested 200 simultaneous deliveries against Postgres and got exactly one record.

**2. Why not just check "have I seen this key?" in code before inserting?**
Because the check and the insert are two steps, and another request can slip between them. The unique constraint makes it one atomic step.

**3. What if the server crashes after inserting the key but before saving the event?**
They are in the same transaction, so the key is never stored without the event. The sender retries and it is processed normally.

**4. How is the audit log tamper-evident?**
Each record stores a hash of its own contents plus the previous record's hash. Changing any record breaks its own hash, and deleting one breaks the next record's link. `verifyAuditChain` walks the chain and the dashboard shows the result. It detects tampering. It does not prevent it, since someone with database access could rewrite the whole chain.

**5. What would you change for 100x traffic?**
The advisory lock serialises audit appends, so that is the first bottleneck. I would write audit records from a single queue consumer, or shard the chain per merchant. The keys table needs expiry. Metrics need to leave process memory and go to a metrics system.

**6. Why rules instead of an LLM for the diagnosis?**
Every decision has to be explainable and testable, and money is involved. An LLM could propose a diagnosis with a confidence, but the policy layer would still have the final say. I would measure it on the same evaluation set before trusting it.

**7. How do you know the diagnosis is any good?**
Two suites. A 21-case suite of templated scenarios (it scores 100% and mostly checks for regressions) and a 47-case hand-written stress set with typos, Hinglish and conflicting signals. The stress set went from 72.3% to 97.9% with 0 unsafe actions. I wrote the cases myself, so I do not claim this is production accuracy.

**8. What does "unsafe action" mean in your evaluation?**
A case that must be held for a human (duplicate, dispute, retry limit, unknown) but ended up queued for a customer-facing action. That is the error that costs trust, so it is tracked separately from accuracy and CI fails if it is ever non-zero.

**9. Why is it safe to log the webhook body?**
It is not logged raw. The stored event is a reduced record, and the dashboard only receives that. No card data is involved because Razorpay does not send it.

**10. What would you do next?**
Add a real Razorpay Test Mode loop end to end (failed payment, webhook, approved action, outcome), expire old idempotency keys, move the audit appends behind a queue, and evaluate an LLM diagnoser against the same cases.

## Things I should say honestly

- All data is synthetic or Razorpay Test Mode. There are no real merchants and no real recovery numbers.
- "Recovered value" in the demo is a labelled simulation, not a measured result.
- The audit chain proves records were not edited after the fact. It does not prove who wrote them.
- I built this with AI assistance. I can walk through every file listed above and change any rule live.

## Files to know by heart

`core.mjs` (rules and policy), `pg-store.mjs` (the transaction), `idempotency.mjs` (keys), `audit.mjs` (hash chain), `webhook.mjs` (signature), `server.mjs` (the route that ties them together).
