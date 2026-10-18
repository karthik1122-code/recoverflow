# Deploy RecoverFlow

You end up with two URLs:

- **Workspace** (`recoverflow`): the real product for pilot stores. Accounts on, Postgres, your Razorpay keys.
- **Demo** (`recoverflow-demo`): the public demo the landing page links to. Sample customers, simulated links, no keys, resets on every restart.

Vercel is not used for the workspace: it needs one always-running Node process that receives webhooks and talks to Postgres.

## 1. Database

Create a Postgres database and copy its connection string.

- Render Postgres works and sits next to the app. The free tier is deleted after 30 days, so use a paid plan for a pilot.
- Neon's free tier does not expire and is enough for the first few stores.

RecoverFlow creates its tables on first start.

## 2. Deploy on Render

1. Sign in to Render with GitHub.
2. **New → Blueprint**, choose the `recoverflow` repository. Render reads `render.yaml` and proposes both services.
3. For `recoverflow`, fill in:
   - `DATABASE_URL`: the connection string from step 1
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`: **test mode** keys (`rzp_test_…`)
   - `MERCHANT_NAME`: the store name customers will recognise
   - `RAZORPAY_WEBHOOK_SECRET` and `SETUP_TOKEN` are generated for you. Copy both.
4. Deploy. Open `https://<workspace>.onrender.com/login.html`, enter the setup token, and create your admin account.
5. Set `DEMO_URL` on the workspace to the demo service's URL (for example `https://recoverflow-demo.onrender.com`). Every "Try the demo" link on the landing page goes to `/demo`, which forwards there. Pilot requests from the landing page are stored in the workspace's audit trail, so they survive restarts.

## 3. Connect Razorpay (test mode first)

The **Connect Razorpay** page inside the app shows the exact webhook URL and has a copy button.

1. Razorpay Dashboard, switch to **Test Mode**.
2. **Account & Settings → Webhooks → Add New Webhook**.
3. URL: `https://<workspace>.onrender.com/webhooks/razorpay`
4. Secret: the `RAZORPAY_WEBHOOK_SECRET` value from Render.
5. Events: `payment.failed`, `subscription.pending`, `subscription.halted`, `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled`.
6. Back in RecoverFlow, press **Send a test failure** on the Connect page. A case marked "Test" appears in the inbox.

## 4. Full test-mode run (do this before any real store)

1. Make a test payment fail in Razorpay test mode (their test cards include ones that always fail).
2. Within seconds a case appears under **Needs approval**. Open it and check the reason.
3. Press **Review and send link**, then **Send payment link**. Razorpay test mode creates the link.
4. Open the link and pay with a test card that succeeds.
5. The case moves to **Recovered** on its own, the weekly report shows the amount, and the audit trail shows every step with your name.

Record this run for the 60-second Loom you send to stores.

## 5. Going live for a pilot store

The store does this on **their** Razorpay account, ideally on a call with you:

1. Give them their own workspace: a new Render service (or the same blueprint) with their own `DATABASE_URL` and `MERCHANT_NAME`.
2. They add the webhook (step 3) in **Live Mode** and generate live API keys.
3. Set `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` to the `rzp_live_` keys **and** `RAZORPAY_MODE=live`. Without `RAZORPAY_MODE=live`, live keys are refused on purpose.
4. Create their admin account with the setup token, then add their ops person as an approver on the Team page.

One store per workspace keeps every store's data fully separate while there are only a few pilots.

## Checks after any deploy

- `GET /health` returns `{"status":"ok"}`.
- Connect page shows the webhook secret as set and Razorpay as connected.
- Audit trail says "Chain intact".
