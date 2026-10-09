import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from './store.mjs';
import { verifyAuditChain } from './audit.mjs';

const record = id => ({ event: { id }, audit: { title: `Webhook ${id}`, detail: 'ok', payment_id: id }, value: id });

test('200 concurrent deliveries of the same event are recorded exactly once', async () => {
  const store = createMemoryStore();
  const results = await Promise.all(Array.from({ length: 200 }, () => store.commitWebhook('evt:1', async () => { await new Promise(r => setImmediate(r)); return record('pay_1'); })));
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal(results.filter(r => r.duplicate).length, 199);
  const { events, audit } = store.snapshot();
  assert.equal(events.length, 1);
  assert.equal(audit.length, 1);
});

test('20 distinct events, each delivered 10 times, give 20 records and a valid audit chain', async () => {
  const store = createMemoryStore();
  const jobs = [];
  for (let round = 0; round < 10; round += 1) for (let n = 0; n < 20; n += 1) jobs.push(store.commitWebhook(`evt:${n}`, () => record(`pay_${n}`)));
  const results = await Promise.all(jobs);
  assert.equal(results.filter(r => !r.duplicate).length, 20);
  const { events, audit } = store.snapshot();
  assert.equal(events.length, 20);
  assert.deepEqual(verifyAuditChain(audit), { valid: true, records: 20, head_hash: audit[0].integrity_hash });
});

test('a failure mid-processing records nothing and the retry is processed normally', async () => {
  const store = createMemoryStore();
  await assert.rejects(store.commitWebhook('evt:retry', async () => { throw new Error('crash before commit'); }), /crash before commit/);
  assert.equal(store.snapshot().events.length, 0);
  assert.equal(store.snapshot().audit.length, 0);
  const retry = await store.commitWebhook('evt:retry', () => record('pay_retry'));
  assert.equal(retry.duplicate, false);
  const again = await store.commitWebhook('evt:retry', () => record('pay_retry'));
  assert.equal(again.duplicate, true);
  assert.equal(store.snapshot().events.length, 1);
});

test('a duplicate that arrives while the first attempt is still in flight is not processed twice', async () => {
  const store = createMemoryStore();
  let release;
  const gate = new Promise(r => { release = r; });
  const first = store.commitWebhook('evt:slow', async () => { await gate; return record('pay_slow'); });
  const second = await store.commitWebhook('evt:slow', () => record('pay_slow'));
  assert.equal(second.duplicate, true);
  release();
  assert.equal((await first).duplicate, false);
  assert.equal(store.snapshot().events.length, 1);
});

test('out-of-scope events keep their key but record nothing', async () => {
  const store = createMemoryStore();
  const first = await store.commitWebhook('evt:ignored', () => ({ value: 'ignored' }));
  assert.equal(first.duplicate, false);
  assert.equal((await store.commitWebhook('evt:ignored', () => ({ value: 'ignored' }))).duplicate, true);
  assert.equal(store.snapshot().events.length, 0);
});

test('records are capped and the audit chain stays valid after trimming', async () => {
  const store = createMemoryStore({ maxRecords: 25 });
  for (let n = 0; n < 60; n += 1) await store.commitWebhook(`evt:${n}`, () => record(`pay_${n}`));
  const { events, audit, anchor } = store.snapshot();
  assert.equal(events.length, 25);
  assert.equal(audit.length, 25);
  assert.equal(verifyAuditChain(audit, anchor).valid, true);
  audit[10].detail = 'tampered';
  assert.equal(verifyAuditChain(audit, anchor).valid, false);
});
