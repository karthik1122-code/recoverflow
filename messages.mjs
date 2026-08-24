import { diagnose, policyDecision } from './core.mjs';

const templates = {
  en: {
    transient_bank_failure: amount => `Your payment of ₹${amount} did not complete because of a temporary bank issue. No action has been taken automatically. If you would like to continue, here is a secure payment link.`,
    insufficient_funds: amount => `Your payment of ₹${amount} did not complete. If you would still like to proceed, you can use this secure payment link whenever convenient.`,
    mandate_or_card_issue: amount => `We could not complete your ₹${amount} recurring payment. Please update your payment method using this secure link if you would like to continue your subscription.`,
    high_intent_abandonment: amount => `Your checkout for ₹${amount} is still available. If you need it, here is a secure link to complete the payment.`,
  },
  hinglish: {
    transient_bank_failure: amount => `₹${amount} ka payment temporary bank issue ki wajah se complete nahi hua. Humne koi automatic action nahi liya hai. Agar aap continue karna chahte hain, yeh secure payment link use kar sakte hain.`,
    insufficient_funds: amount => `₹${amount} ka payment complete nahi hua. Agar aap proceed karna chahte hain, aap apni convenience ke hisaab se yeh secure payment link use kar sakte hain.`,
    mandate_or_card_issue: amount => `Aapka ₹${amount} recurring payment complete nahi hua. Subscription continue karne ke liye secure link se payment method update kar sakte hain.`,
    high_intent_abandonment: amount => `Aapka ₹${amount} checkout abhi bhi available hai. Zaroorat ho toh secure link se payment complete kar sakte hain.`,
  },
};

export function draftRecoveryMessage(event, language = 'en') {
  const diagnosis = diagnose(event);
  const decision = policyDecision(event, diagnosis);
  if (decision.status !== 'approval_required') return {allowed:false, reason:decision.reason, diagnosis, decision};
  const chosenLanguage = language === 'hinglish' ? 'hinglish' : 'en';
  const template = templates[chosenLanguage][diagnosis.label];
  if (!template) return {allowed:false, reason:'No compliant message template exists for this recovery type.', diagnosis, decision};
  return {allowed:true, language:chosenLanguage, diagnosis, decision, message:template((event.amount / 100).toLocaleString('en-IN')) + ' [PAYMENT_LINK]'};
}
