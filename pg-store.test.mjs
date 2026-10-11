import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore } from './pg-store.mjs';
import { verifyAuditChain } from './audit.mjs';

// Runs against a real Postgres. Skipped unless TEST_DATABASE_URL is set:
//   TEST_DATABASE_URL=postgres://user:pass@host/db npm test
const url = process.env.TEST_DATABASE_URL;
const record = id => ({ event: { id }, audit: { title: `Webhook ${id}`, detail: 'ok', payment_id: id }, value: id });
const open = async opts => {
  const store = await createPostgresStore({ connectionString: url, ...opts });
  return store;
};
const reset = async () => {
  const store = await open();
  await store.close();
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('TRUNCATE webhook_keys, events, audit RESTART IDENTITY');
  await pool.end();
};
const opts = { skip: !url && 'TEST_DATABASE_URL not set' };

test('pg: 200 concurrent deliveries of one event are recorded exactly once', opts, async () => {
  await reset();
  const store = await open();
  const results = await Promise.all(Array.from({ length: 200 }, () => store.commitWebhook('evt:1', async () => { await new Promise(r => setImmediate(r)); return record('pay_1'); })));
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  const { events, audit } = await store.snapshot();
  assert.equal(events.length, 1);
  assert.equal(audit.length, 1);
  await store.close();
});

test('pg: 20 events x 10 deliveries give 20 records and a valid audit chain', opts, async () => {
  await reset();
  const store = await open();
  const jobs = [];
  for (let round = 0; round < 10; round += 1) for (let n = 0; n < 20; n += 1) jobs.push(store.commitWebhook(`evt:${n}`, () => record(`pay_${n}`)));
  const results = await Promise.all(jobs);
  assert.equal(results.filter(r => !r.duplicate).length, 20);
  const { events, audit, anchor } = await store.snapshot();
  assert.equal(events.length, 20);
  assert.equal(verifyAuditChain(audit, anchor).valid, true);
  await store.close();
});

test('pg: a failure rolls everything back and the retry is processed', opts, async () => {
  await reset();
  const store = await open();
  await assert.rejects(store.commitWebhook('evt:x', () => { throw new Error('boom'); }), /boom/);
  assert.equal((await store.snapshot()).events.length, 0);
  assert.equal((await store.commitWebhook('evt:x', () => record('pay_x'))).duplicate, false);
  assert.equal((await store.snapshot()).events.length, 1);
  await store.close();
});

test('pg: a concurrent duplicate of a FAILING attempt is still processed afterwards', opts, async () => {
  await reset();
  const store = await open();
  const first = store.commitWebhook('evt:y', async () => { await new Promise(r => setTimeout(r, 50)); throw new Error('boom'); });
  const second = store.commitWebhook('evt:y', () => record('pay_y'));
  await assert.rejects(first, /boom/);
  assert.equal((await second).duplicate, false);
  assert.equal((await store.snapshot()).events.length, 1);
  await store.close();
});

test('pg: data survives a restart (new store instance, same database)', opts, async () => {
  await reset();
  const a = await open();
  await a.commitWebhook('evt:keep', () => record('pay_keep'));
  await a.close();
  const b = await open();
  const { events, audit, anchor } = await b.snapshot();
  assert.equal(events.length, 1);
  assert.equal(verifyAuditChain(audit, anchor).valid, true);
  assert.equal((await b.commitWebhook('evt:keep', () => record('pay_keep'))).duplicate, true);
  await b.close();
});

test('pg: a windowed snapshot still verifies and tampering is still detected', opts, async () => {
  await reset();
  const store = await open({ maxRecords: 25 });
  for (let n = 0; n < 60; n += 1) await store.commitWebhook(`evt:${n}`, () => record(`pay_${n}`));
  const { events, audit, anchor } = await store.snapshot();
  assert.equal(events.length, 25);
  assert.equal(audit.length, 25);
  assert.notEqual(anchor, 'GENESIS');
  assert.equal(verifyAuditChain(audit, anchor).valid, true);
  const tampered = structuredClone(audit);
  tampered[10].detail = 'changed';
  assert.equal(verifyAuditChain(tampered, anchor).valid, false);
  await store.close();
});
