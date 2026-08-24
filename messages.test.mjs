import test from 'node:test';
import assert from 'node:assert/strict';
import { draftRecoveryMessage } from './messages.mjs';

test('creates a Hinglish draft for an eligible bank-timeout recovery', () => {
  const result = draftRecoveryMessage({amount:12500,error_description:'issuer timeout',customer_opted_in:true,retry_count:0}, 'hinglish');
  assert.equal(result.allowed, true);
  assert.match(result.message, /secure payment link/);
});
test('never creates a message when customer contact lacks consent', () => {
  const result = draftRecoveryMessage({amount:12500,error_description:'insufficient balance',customer_opted_in:false,retry_count:0}, 'en');
  assert.equal(result.allowed, false);
  assert.equal(result.decision.policy_code, 'NO_CONSENT');
});
