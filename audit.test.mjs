import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAudit, verifyAuditChain } from './audit.mjs';

test('validates a linked audit history', () => {
  const chain = [];
  appendAudit(chain, {title:'Recovery queued', detail:'Evidence collected.', payment_id:'pay_1'});
  appendAudit(chain, {title:'Policy held', detail:'Duplicate risk.', payment_id:'pay_1'});
  assert.equal(verifyAuditChain(chain).valid, true);
});
test('detects a changed audit record', () => {
  const chain = [];
  appendAudit(chain, {title:'Recovery queued', detail:'Evidence collected.', payment_id:'pay_1'});
  chain[0].detail = 'Evidence removed.';
  assert.equal(verifyAuditChain(chain).valid, false);
});
