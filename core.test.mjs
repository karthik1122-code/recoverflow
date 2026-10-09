import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, policyDecision } from './core.mjs';

test('transient issuer failure gets a bounded recommendation', () => {
  const event = {error_description:'issuer timeout', customer_opted_in:true, retry_count:0, amount:12000};
  const diagnosis = diagnose(event); const decision = policyDecision(event, diagnosis);
  assert.equal(diagnosis.label, 'transient_bank_failure');
  assert.equal(decision.status, 'approval_required');
});
test('duplicate risk is held regardless of amount', () => {
  const diagnosis = diagnose({duplicate_suspected:true, customer_opted_in:true});
  assert.equal(policyDecision({duplicate_suspected:true}, diagnosis).status, 'held');
});
test('no contact without explicit consent', () => {
  const event = {error_description:'insufficient balance', customer_opted_in:false, amount:100};
  assert.equal(policyDecision(event, diagnose(event)).policy_code, 'NO_CONSENT');
});

test('actions above the high-value threshold (in paise) go to an accounts owner', async () => {
  const { diagnose, policyDecision, HIGH_VALUE_PAISE } = await import('./core.mjs');
  const base = {error_description:'issuer timeout', customer_opted_in:true, retry_count:0};
  const ok = {...base, amount: HIGH_VALUE_PAISE};
  assert.equal(policyDecision(ok, diagnose(ok)).status, 'approval_required');
  const big = {...base, amount: HIGH_VALUE_PAISE + 1};
  assert.equal(policyDecision(big, diagnose(big)).policy_code, 'HIGH_VALUE_REVIEW');
});
