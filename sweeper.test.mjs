import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from './store.mjs';
import { initialRecovery, statusOf, transition } from './cases.mjs';
import { sweepStaleApprovals } from './sweeper.mjs';

const T0 = Date.parse('2026-10-18T10:00:00Z');
async function storeWith(...ids) {
  const store = createMemoryStore();
  for (const id of ids) await store.commitWebhook(`k:${id}`, () => ({ event: { id, amount: 100, decision: { status: 'approval_required' }, recovery: initialRecovery({ status: 'approval_required' }) }, value: 1 }));
  return store;
}
const claimAt = (store, id, iso) => store.updateEvent(id, r => transition(r, 'claim', { by: 'a' }, iso));

test('a stale approval whose link exists at Razorpay is completed, not duplicated', async () => {
  const store = await storeWith('pay_1');
  await claimAt(store, 'pay_1', new Date(T0).toISOString());
  const asked = [];
  const provider = { findPaymentLinkByReference: async ref => { asked.push(ref); return { id: 'plink_9', short_url: 'u', status: 'created', expire_by: null }; } };
  const result = await sweepStaleApprovals({ store, provider, staleMs: 600_000, now: T0 + 11 * 60_000 });
  assert.deepEqual(result, { checked: 1, linked: 1, released: 0, skipped: 0 });
  assert.deepEqual(asked, ['rf_pay_1']);
  const r = await store.getEvent('pay_1');
  assert.equal(statusOf(r), 'link_sent');
  assert.equal(r.recovery.link.id, 'plink_9');
  assert.equal((await store.snapshot()).audit[0].title, 'Unfinished approval completed');
});

test('a stale approval with no link is released so a human can approve again', async () => {
  const store = await storeWith('pay_2');
  await claimAt(store, 'pay_2', new Date(T0).toISOString());
  const result = await sweepStaleApprovals({ store, provider: { findPaymentLinkByReference: async () => null }, staleMs: 600_000, now: T0 + 20 * 60_000 });
  assert.equal(result.released, 1);
  assert.equal(statusOf(await store.getEvent('pay_2')), 'open');
});

test('fresh approvals are left alone, and an unreachable Razorpay changes nothing', async () => {
  const store = await storeWith('pay_3', 'pay_4');
  await claimAt(store, 'pay_3', new Date(T0).toISOString());
  await claimAt(store, 'pay_4', new Date(T0 + 9 * 60_000).toISOString());
  const result = await sweepStaleApprovals({ store, provider: { findPaymentLinkByReference: async () => { throw new Error('down'); } }, staleMs: 600_000, now: T0 + 12 * 60_000 });
  assert.deepEqual(result, { checked: 1, linked: 0, released: 0, skipped: 1 });
  assert.equal(statusOf(await store.getEvent('pay_3')), 'approving');
  assert.equal(statusOf(await store.getEvent('pay_4')), 'approving');
});

test('a case finished by the normal path during the lookup is not touched', async () => {
  const store = await storeWith('pay_5');
  await claimAt(store, 'pay_5', new Date(T0).toISOString());
  const provider = { findPaymentLinkByReference: async () => { await store.updateEvent('pay_5', r => transition(r, 'link_sent', { id: 'plink_real', short_url: 'u' })); return null; } };
  const result = await sweepStaleApprovals({ store, provider, staleMs: 600_000, now: T0 + 11 * 60_000 });
  assert.equal(result.released, 0);
  const r = await store.getEvent('pay_5');
  assert.equal(statusOf(r), 'link_sent');
  assert.equal(r.recovery.link.id, 'plink_real');
});
