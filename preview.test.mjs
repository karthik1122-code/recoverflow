import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from './preview/sha256.mjs';

test('preview SHA-256 matches Node for every length around block boundaries and for unicode', () => {
  for (let n = 0; n < 200; n += 1) {
    const text = 'a₹'.repeat(n).slice(0, n);
    assert.equal(sha256(text), createHash('sha256').update(text).digest('hex'), `length ${n}`);
  }
  const record = JSON.stringify({ id: 'audit_1', title: 'Payment recovered', detail: '₹2,499 paid', payment_id: 'pay_1', at: '2026-10-19T00:00:00Z', previous_hash: 'GENESIS' });
  assert.equal(sha256(record), createHash('sha256').update(record).digest('hex'));
});
