// updateEvent contract, checked against BOTH stores: atomic, serialised, audited, all-or-nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from './store.mjs';
import { createPostgresStore } from './pg-store.mjs';
import { verifyAuditChain } from './audit.mjs';
import { CaseError, initialRecovery, transition } from './cases.mjs';

const url = process.env.TEST_DATABASE_URL_CASES;
const kinds = [
  ['memory', async () => createMemoryStore()],
  ['postgres', async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    const store = await createPostgresStore({ pool });
    await pool.query('TRUNCATE webhook_keys, events, audit RESTART IDENTITY');
    return store;
  }],
];
const seed = async (store, id) => store.commitWebhook(`k:${id}`, () => ({ event: { id, amount: 5000, decision: { status: 'approval_required' }, recovery: initialRecovery({ status: 'approval_required' }) }, value: id }));

for (const [kind, make] of kinds) {
  const opts = { skip: kind === 'postgres' && !url && 'TEST_DATABASE_URL_CASES not set' };

  test(`${kind}: updateEvent writes the record and its audit entry together`, opts, async () => {
    const store = await make();
    await seed(store, 'pay_1');
    const next = await store.updateEvent('pay_1', r => transition(r, 'claim', { by: 'a' }), r => ({ title: 'Recovery approved', detail: r.recovery.status, payment_id: r.id }));
    assert.equal(next.recovery.status, 'approving');
    assert.equal((await store.getEvent('pay_1')).recovery.status, 'approving');
    const { audit, anchor } = await store.snapshot();
    assert.equal(audit[0].title, 'Recovery approved');
    assert.equal(verifyAuditChain(audit, anchor).valid, true);
    await store.close?.();
  });

  test(`${kind}: a throwing mutate changes nothing and writes no audit`, opts, async () => {
    const store = await make();
    await seed(store, 'pay_2');
    const auditBefore = (await store.snapshot()).audit.length;
    await assert.rejects(store.updateEvent('pay_2', () => { throw new CaseError('invalid_transition'); }, () => ({ title: 'never', detail: '', payment_id: 'pay_2' })), CaseError);
    assert.equal((await store.getEvent('pay_2')).recovery.status, 'open');
    assert.equal((await store.snapshot()).audit.length, auditBefore);
    await store.close?.();
  });

  test(`${kind}: unknown ids return null`, opts, async () => {
    const store = await make();
    assert.equal(await store.updateEvent('missing', r => r), null);
    assert.equal(await store.getEvent('missing'), null);
    await store.close?.();
  });

  test(`${kind}: 50 concurrent claims on one case succeed exactly once`, opts, async () => {
    const store = await make();
    await seed(store, 'pay_3');
    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => store.updateEvent('pay_3', async r => { await new Promise(res => setImmediate(res)); return transition(r, 'claim', { by: `u${i}` }); })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'invalid_transition'));
    assert.equal((await store.getEvent('pay_3')).recovery.history.length, 1);
    await store.close?.();
  });
}
