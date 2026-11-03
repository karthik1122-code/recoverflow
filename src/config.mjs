// Every environment variable the server reads, in one place.
export const config = {
  port: Number(process.env.PORT || 4173),
  databaseUrl: process.env.DATABASE_URL || '',
  // Accounts are on by default. AUTH=off serves the synthetic demo with no sign-in; the webhook stays signature-protected either way.
  authOn: process.env.AUTH !== 'off',
  setupToken: process.env.SETUP_TOKEN || '',
  enableTestLinks: process.env.ENABLE_TEST_LINKS === 'true',
  // Only trust X-Forwarded-For behind a known proxy (Render); otherwise a client could spoof its address.
  trustProxy: process.env.TRUST_PROXY === 'true',
  isProduction: process.env.NODE_ENV === 'production',
  webhookSecret: () => process.env.RAZORPAY_WEBHOOK_SECRET,
  razorpay: () => ({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET }),
  maxBody: 100 * 1024,
  maxRecords: 500,
};
