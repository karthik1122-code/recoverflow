import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from './metrics.mjs';

test('counts each kind and rejects unknown kinds', () => {
  const m = createMetrics();
  m.record('received'); m.record('received'); m.record('duplicates_blocked'); m.record('signature_failures');
  const s = m.snapshot();
  assert.equal(s.received, 2);
  assert.equal(s.duplicates_blocked, 1);
  assert.equal(s.signature_failures, 1);
  assert.throws(() => m.record('nope'), /unknown metric/);
});

test('per-minute buckets are ordered oldest to newest and old minutes drop out', () => {
  let t = 1_700_000_000_000;
  const m = createMetrics({ windowMinutes: 5, now: () => t });
  m.record('received');
  t += 60_000; m.record('received'); m.record('received');
  let s = m.snapshot();
  assert.deepEqual(s.per_minute, [0, 0, 0, 1, 2]);
  t += 5 * 60_000;
  s = m.snapshot();
  assert.deepEqual(s.per_minute, [0, 0, 0, 0, 0]);
  assert.equal(s.received, 3);
});
