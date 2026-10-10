import { appendAudit } from './audit.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS webhook_keys (
  key        text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  seq  bigserial PRIMARY KEY,
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  seq    bigserial PRIMARY KEY,
  record jsonb NOT NULL
);`;

// Appends to the hash chain must be serialised, otherwise two writers could both link to the same head.
const AUDIT_LOCK = 727001;

/**
 * Postgres store with the same contract as the memory store.
 *
 * commitWebhook runs in ONE transaction:
 *   1. INSERT the idempotency key. A unique-key conflict means it is a duplicate, so we stop.
 *      A concurrent duplicate blocks on the unique index until the first transaction finishes,
 *      then sees the conflict (or, if the first rolled back, proceeds): this is exactly the
 *      "retry after a failed attempt still works" behaviour, enforced by the database.
 *   2. run build(), then insert the event and the audit record.
 *   3. COMMIT. If anything throws, ROLLBACK releases the key and records nothing.
 */
export async function createPostgresStore({ connectionString, pool: existingPool, maxRecords = 500 } = {}) {
  let pool = existingPool;
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  await pool.query(SCHEMA);

  async function appendAuditRow(client, input) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK]);
    const head = await client.query('SELECT record FROM audit ORDER BY seq DESC LIMIT 1');
    const chain = head.rows[0] ? [head.rows[0].record] : [];
    const record = appendAudit(chain, input);
    await client.query('INSERT INTO audit (record) VALUES ($1)', [record]);
    return record;
  }

  return {
    async commitWebhook(key, build) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const claim = await client.query('INSERT INTO webhook_keys (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
        if (claim.rowCount === 0) { await client.query('ROLLBACK'); return { duplicate: true }; }
        const staged = await build();
        if (staged.event) await client.query('INSERT INTO events (data) VALUES ($1)', [staged.event]);
        if (staged.audit) await appendAuditRow(client, staged.audit);
        await client.query('COMMIT');
        return { duplicate: false, value: staged.value };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw error;
      } finally {
        client.release();
      }
    },
    async addAudit(title, detail, payment_id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const record = await appendAuditRow(client, { title, detail, payment_id });
        await client.query('COMMIT');
        return record;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      } finally {
        client.release();
      }
    },
    /** Newest-first. `anchor` is the hash of the record just beyond the window, so the window still verifies. */
    async snapshot() {
      const [events, audit] = await Promise.all([
        pool.query('SELECT data FROM events ORDER BY seq DESC LIMIT $1', [maxRecords]),
        pool.query('SELECT record FROM audit ORDER BY seq DESC LIMIT $1', [maxRecords + 1]),
      ]);
      const rows = audit.rows.map(r => r.record);
      const anchor = rows.length > maxRecords ? rows[maxRecords].integrity_hash : 'GENESIS';
      return { events: events.rows.map(r => r.data), audit: rows.slice(0, maxRecords), anchor };
    },
    async close() { await pool.end(); },
    _pool: pool,
  };
}
