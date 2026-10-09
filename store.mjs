import { appendAudit } from './audit.mjs';

/**
 * In-memory store with the same contract a database store must satisfy.
 *
 * commitWebhook(key, build) is atomic: the idempotency key, the event record
 * and its audit entry are committed together or not at all.
 *   - A key that is already claimed (finished OR still in flight) returns {duplicate:true}.
 *   - If build() throws, the claim is released and nothing is recorded, so the
 *     sender's retry is processed normally. No event is ever lost to a half-finished attempt.
 *   - build() returns {event?, audit?, value}. Without `event` the key stays claimed
 *     but nothing is recorded (used for out-of-scope events).
 */
export function createMemoryStore({ maxRecords = 500 } = {}) {
  const events = [];
  const audit = [];
  const claimed = new Set();
  let anchor = 'GENESIS';
  const trim = list => { if (list.length > maxRecords) list.length = maxRecords; };
  const trimAudit = () => { if (audit.length > maxRecords) { anchor = audit[maxRecords].integrity_hash; audit.length = maxRecords; } };

  return {
    async commitWebhook(key, build) {
      if (claimed.has(key)) return { duplicate: true };
      claimed.add(key);
      let staged;
      try {
        staged = await build();
      } catch (error) {
        claimed.delete(key);
        throw error;
      }
      if (staged.event) events.unshift(staged.event);
      if (staged.audit) appendAudit(audit, staged.audit);
      trim(events);
      trimAudit();
      return { duplicate: false, value: staged.value };
    },
    async addAudit(title, detail, payment_id) {
      const record = appendAudit(audit, { title, detail, payment_id });
      trimAudit();
      return record;
    },
    snapshot() {
      return { events, audit, anchor };
    },
  };
}
