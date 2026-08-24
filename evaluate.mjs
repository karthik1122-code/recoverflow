import { diagnose, policyDecision } from './core.mjs';

// Fixed, synthetic held-out scenario suite. It is intentionally separate from
// the UI examples and must never be represented as production merchant data.
const scenarios = [
  ...Array.from({length: 8}, (_, i) => ({id:`timeout_${i}`, amount:10000 + i * 500, error_description:'issuer network timeout', customer_opted_in:true, retry_count:0, expected:'transient_bank_failure', recoverable:true})),
  ...Array.from({length: 5}, (_, i) => ({id:`funds_${i}`, amount:6500 + i * 1000, error_description:'insufficient balance', customer_opted_in:true, retry_count:0, expected:'insufficient_funds', recoverable:true})),
  ...Array.from({length: 3}, (_, i) => ({id:`mandate_${i}`, amount:12000 + i * 1000, error_description:'mandate expired', customer_opted_in:true, retry_count:0, expected:'mandate_or_card_issue', recoverable:true})),
  ...Array.from({length: 2}, (_, i) => ({id:`duplicate_${i}`, amount:9000, duplicate_suspected:true, customer_opted_in:true, expected:'possible_duplicate', recoverable:false})),
  {id:'no_consent', amount:4000, error_description:'insufficient balance', customer_opted_in:false, retry_count:0, expected:'insufficient_funds', recoverable:false, expectedPolicy:'NO_CONSENT'},
  {id:'retry_limit', amount:7000, error_description:'issuer timeout', customer_opted_in:true, retry_count:1, expected:'retry_limit_reached', recoverable:false},
  {id:'unknown', amount:3000, error_description:'unclassified error', customer_opted_in:true, retry_count:0, expected:'unknown', recoverable:false},
];

const results = scenarios.map(event => { const diagnosis=diagnose(event), decision=policyDecision(event, diagnosis); return {...event, diagnosis, decision}; });
const correct = results.filter(r => r.expected === r.diagnosis.label).length;
const policyCorrect = results.filter(r => !r.expectedPolicy || r.decision.policy_code === r.expectedPolicy).length;
const eligible = results.filter(r => r.decision.status === 'approval_required');
const protectedValue = results.filter(r => r.decision.status === 'held').reduce((sum, r) => sum + r.amount, 0);
// Conservative test-only simulation: 60% of approved actions recover; it is
// not a claim about live merchant conversion.
const simulatedRecovered = Math.round(eligible.reduce((sum, r) => sum + r.amount, 0) * 0.60);

console.log(JSON.stringify({
  suite:'RecoverFlow synthetic held-out scenario suite v1',
  disclaimer:'Scenario regression evaluation only; not a live merchant performance claim.',
  records:results.length,
  diagnosis_accuracy:Number((correct / results.length).toFixed(3)),
  policy_assertion_accuracy:Number((policyCorrect / results.length).toFixed(3)),
  approval_required:eligible.length,
  exceptions_held:results.length - eligible.length,
  protected_value_inr:protectedValue,
  simulated_recovered_inr:simulatedRecovered,
  cases:results.map(r => ({id:r.id, expected:r.expected, predicted:r.diagnosis.label, policy:r.decision.policy_code})),
}, null, 2));
