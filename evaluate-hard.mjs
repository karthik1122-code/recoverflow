import { diagnose, policyDecision } from './core.mjs';
import { cases } from './eval-cases.mjs';

const rows = cases.map(event => {
  const diagnosis = diagnose(event);
  const decision = policyDecision(event, diagnosis);
  return { ...event, predicted: diagnosis.label, decision };
});

const labels = [...new Set([...rows.map(r => r.expected), ...rows.map(r => r.predicted)])].sort();
const matrix = Object.fromEntries(labels.map(a => [a, Object.fromEntries(labels.map(b => [b, 0]))]));
for (const r of rows) matrix[r.expected][r.predicted] += 1;

const perClass = labels.map(label => {
  const tp = matrix[label][label];
  const fn = labels.reduce((s, b) => s + (b === label ? 0 : matrix[label][b]), 0);
  const fp = labels.reduce((s, a) => s + (a === label ? 0 : matrix[a][label]), 0);
  return { label, support: tp + fn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(2) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(2) : null };
});

const holdClasses = ['possible_duplicate', 'dispute_risk', 'retry_limit_reached', 'unknown'];
// Dangerous error: the case should never be actioned, yet the engine queued a customer-facing action.
const unsafe = rows.filter(r => holdClasses.includes(r.expected) && r.decision.status === 'approval_required');
const policyChecked = rows.filter(r => r.expectedPolicy);
const policyWrong = policyChecked.filter(r => r.decision.policy_code !== r.expectedPolicy);
const misses = rows.filter(r => r.expected !== r.predicted);

const report = {
  suite: 'RecoverFlow hard diagnosis set v1 (hand-written, adversarial)',
  disclaimer: 'Author-written stress set. Not production data and not a live performance claim.',
  cases: rows.length,
  diagnosis_accuracy: +((rows.length - misses.length) / rows.length).toFixed(3),
  unsafe_actions: unsafe.length,
  policy_checks: `${policyChecked.length - policyWrong.length}/${policyChecked.length}`,
  per_class: perClass,
  confusion_matrix: matrix,
  misses: misses.map(r => ({ id: r.id, text: r.error_description, expected: r.expected, predicted: r.predicted })),
  unsafe: unsafe.map(r => ({ id: r.id, text: r.error_description, expected: r.expected, predicted: r.predicted })),
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--strict') && (unsafe.length || policyWrong.length)) process.exit(1);
