import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const report = JSON.parse(execFileSync(process.execPath, ['evaluate-hard.mjs'], { encoding: 'utf8' }));

test('hard set: no case that must be held ever becomes a customer-facing action', () => {
  assert.deepEqual(report.unsafe, []);
});

test('hard set: policy checks all hold (consent, high value boundary)', () => {
  const [ok, total] = report.policy_checks.split('/').map(Number);
  assert.equal(ok, total);
});

test('hard set: diagnosis accuracy does not regress below 95%', () => {
  assert.ok(report.diagnosis_accuracy >= 0.95, `accuracy fell to ${report.diagnosis_accuracy}`);
});
