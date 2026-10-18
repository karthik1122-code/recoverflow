import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './report.mjs';
import { initialRecovery, transition } from './cases.mjs';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const daysAgo = d => new Date(NOW - d * 86_400_000).toISOString();
const make = (id, amount, label, receivedDaysAgo) => ({ id, amount, diagnosis: { label }, decision: { status: 'approval_required' }, recovery: initialRecovery({ status: 'approval_required' }), received_at: daysAgo(receivedDaysAgo), customer: { name: `N ${id}` } });
const recover = (r, d) => transition(transition(transition(r, 'claim', {}, daysAgo(d + 0.1)), 'link_sent', { id: 'l', short_url: 'u' }, daysAgo(d + 0.1)), 'paid', { amount_paid: r.amount }, daysAgo(d));
const send = (r, d) => transition(transition(r, 'claim', {}, daysAgo(d)), 'link_sent', { id: 'l', short_url: 'u' }, daysAgo(d));

test('weekly report counts only what happened inside the window', () => {
  const records = [
    recover(make('a', 2000, 'insufficient_funds', 2), 1),
    recover(make('b', 5000, 'transient_bank_failure', 3), 2),
    send(make('c', 1000, 'transient_bank_failure', 1), 1),
    make('d', 9000, 'possible_duplicate', 4),
    recover(make('old', 7000, 'insufficient_funds', 20), 19),
  ];
  const r = buildReport(records, { days: 7, now: NOW });
  assert.equal(r.failed_count, 4);
  assert.equal(r.failed_amount, 17000);
  assert.equal(r.recovered_count, 2);
  assert.equal(r.recovered_amount, 7000);
  assert.equal(r.links_sent, 3);
  assert.equal(r.recovery_rate, 0.667);
  assert.deepEqual(r.top_reasons.map(x => x.label), ['possible_duplicate', 'transient_bank_failure', 'insufficient_funds']);
  assert.deepEqual(r.recovered.map(x => x.id), ['a', 'b'], 'newest recovery first');
  assert.equal(r.recovered[0].name, 'N a');
  assert.equal(r.daily.length, 7);
  assert.equal(r.daily.reduce((a, d) => a + d.recovered, 0), 7000);
  assert.equal(r.daily.reduce((a, d) => a + d.failed, 0), 17000);
});

test('window is clamped to 1–90 days and empty data is all zeros', () => {
  assert.equal(buildReport([], { days: 999, now: NOW }).days, 90);
  assert.equal(buildReport([], { days: 'x', now: NOW }).days, 7);
  const empty = buildReport([], { now: NOW });
  assert.equal(empty.recovery_rate, 0);
  assert.deepEqual(empty.recovered, []);
});
