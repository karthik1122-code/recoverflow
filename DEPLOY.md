# Deploy RecoverFlow

This deployment keeps credentials out of source control and gives Razorpay a public HTTPS webhook endpoint.

## Before deploying

1. Create a new **private or public GitHub repository** and upload the `recoverflow` folder.
2. Confirm `.env` is not committed. It is already listed in `.gitignore`.
3. Rotate any Test Mode secret that was ever pasted into a chat or shared outside your device.

## Deploy on Render

1. Sign in to Render with GitHub.
2. Select **New → Blueprint**, then choose your RecoverFlow repository.
3. Render reads `render.yaml`; leave the service name as `recoverflow` or choose another unique name.
4. Add these secret environment variables in the Render dashboard:
   - `RAZORPAY_KEY_ID` — Test Mode key ID
   - `RAZORPAY_KEY_SECRET` — Test Mode key secret
   - `RAZORPAY_WEBHOOK_SECRET` — a new long random value
5. Deploy. Copy the public HTTPS URL, for example `https://recoverflow.onrender.com`.

## Configure Razorpay Test Mode webhook

1. In Razorpay Dashboard, switch to **Test Mode**.
2. Go to **Accounts & Settings → Webhooks → Add New Webhook**.
3. Use: `https://YOUR-APP.onrender.com/webhooks/razorpay`
4. Enter the exact value of `RAZORPAY_WEBHOOK_SECRET` from Render.
5. Subscribe to `payment.failed`. Optionally add `subscription.pending` and `subscription.halted`.
6. Save, then trigger one Test Mode payment failure.

## Demo check

- Open the app at its public URL.
- Use **Decision Lab** to prove policy behavior.
- Trigger one real Test Mode failed payment.
- Verify the webhook reaches `/webhooks/razorpay` and creates one recovery case.
- Do not use Live Mode or real customer data for the Buildathon demo.
