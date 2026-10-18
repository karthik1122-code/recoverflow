/**
 * Synthetic Razorpay payloads for the public demo and for the "Send a test failure" button.
 * Every id is prefixed pay_demo_ / pay_test_ so it can never be mistaken for a real payment.
 */
const people = [
  ['Ananya Iyer', 'ananya.iyer@example.in', '+919800011201'],
  ['Rohan Kulkarni', 'rohan.k@example.in', '+919800011202'],
  ['Meher Bansal', 'meher@example.in', '+919800011203'],
  ['Vikram Rao', 'vikram.rao@example.in', '+919800011204'],
  ['Sana Qureshi', 'sana.q@example.in', '+919800011205'],
  ['Arjun Menon', 'arjun.menon@example.in', '+919800011206'],
  ['Kavya Reddy', 'kavya.r@example.in', '+919800011207'],
  ['Ishaan Gupta', 'ishaan.g@example.in', '+919800011208'],
  ['Nila Textiles', 'accounts@nila.example.in', '+919800011209'],
  ['Farah Sheikh', 'farah@example.in', '+919800011210'],
];

// [person, amount ₹, error_description, notes, outcome, hours ago]
const scenarios = [
  [0, 2499, 'Payment failed due to issuer bank timeout after OTP', { recovery_opt_in: 'true' }, 'recovered', 70],
  [1, 4899, 'Insufficient balance in the account', { recovery_opt_in: 'true' }, 'recovered', 52],
  [2, 1299, 'Bank server not responding, please retry', { recovery_opt_in: 'true' }, 'link_sent', 26],
  [3, 18999, 'UPI mandate expired', { recovery_opt_in: 'true' }, 'open', 9],
  [4, 3499, 'Transaction declined: not enough money', { recovery_opt_in: 'true' }, 'open', 5],
  [5, 899, 'Gateway timed out', { recovery_opt_in: 'true' }, 'open', 2],
  [6, 6499, 'Payment failed', { recovery_opt_in: 'true', duplicate_suspected: 'true' }, 'held', 30],
  [7, 2199, 'Insufficient funds', { recovery_opt_in: 'false' }, 'held', 14],
  [8, 45000, 'Card expired, please re-authorize', { recovery_opt_in: 'true' }, 'open', 3],
  [9, 1599, 'Issuer network timeout', { recovery_opt_in: 'true' }, 'expired', 120],
];

export function failurePayload({ id, amount, description, notes = {}, person, createdAt }) {
  const [name, email, contact] = person;
  return {
    event: 'payment.failed',
    created_at: createdAt,
    payload: { payment: { entity: { id, amount: amount * 100, currency: 'INR', email, contact, error_description: description, created_at: createdAt, notes: { customer_name: name, ...notes } } } },
  };
}

export function demoScenarios(now = Date.now()) {
  return scenarios.map(([p, amount, description, notes, outcome, hoursAgo], i) => {
    const createdAt = Math.floor((now - hoursAgo * 3_600_000) / 1000);
    return { outcome, hoursAgo, payload: failurePayload({ id: `pay_demo_${String(i + 1).padStart(3, '0')}`, amount, description, notes, person: people[p], createdAt }) };
  });
}

export function testFailurePayload(now = Date.now()) {
  const person = people[Math.floor(Math.random() * people.length)];
  const createdAt = Math.floor(now / 1000);
  return failurePayload({ id: `pay_test_${createdAt.toString(36)}${Math.floor(Math.random() * 1e4)}`, amount: 1999, description: 'Issuer bank timeout after OTP (test event from RecoverFlow)', notes: { recovery_opt_in: 'true', test_event: 'true' }, person, createdAt });
}

/** The payment_link.paid body Razorpay would send once the customer pays. */
export function paidPayload(record) {
  const link = record.recovery?.link || {};
  return {
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: link.id, amount_paid: record.amount, reference_id: `rf_${record.id}`.slice(0, 40), notes: { rf_case: record.id, source: 'recoverflow' } } },
      payment: { entity: { id: `pay_paid_${record.id.slice(-12)}`, amount: record.amount, created_at: Math.floor(Date.now() / 1000) } },
    },
  };
}
