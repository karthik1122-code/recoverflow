# Sales kit: 30 minutes a day until Nov 9

Goal: one paying store by Nov 9. No pressure beyond that. The only daily target is **messages sent**, not replies.

## Who to message

Small Indian D2C brands that:

- sell on their own website (not only Amazon or Meesho), and
- show Razorpay at checkout (add something to the cart and look at the payment page), and
- have roughly 1k to 50k Instagram followers, so the founder reads their own DMs.

Good categories: skincare and haircare, handmade jewellery, ethnic wear, coffee and tea, pet food, home decor, supplements.

Where to find them: Instagram search for "skincare india", "handmade jewellery india", "small business india"; the "suggested for you" list on any brand you already found; Shopify stores listed on "Made in India" store directories.

## Tracker

Keep one sheet with these columns:

| Brand | Founder | Channel | Sent | Followed up | Replied | Call | Pilot | Paid | Notes |
|---|---|---|---|---|---|---|---|---|---|

Rule of thumb: about 100 messages give 10 to 15 replies, 4 to 6 calls and 1 to 3 pilots. If fewer than 5 of 100 reply, change the message, not the product.

## The 30-minute block

| Minutes | Do |
|---|---|
| 0 to 10 | Add new brands to the sheet |
| 10 to 25 | Send the day's messages |
| 25 to 30 | Reply to anyone who answered, send follow-ups that are due |

## Messages

### 1. Advice message (week 1). Nothing to sell, nothing to reject.

> Hi [Name]! I'm Karthik, a CS student in Hyderabad building a tool for D2C brands on Razorpay. Can I ask you 2 quick questions about failed payments? Roughly how many do you see a month, and do you follow up with those customers today? Not selling anything, just learning.

### 2. Demo message (from week 2, once the Loom exists)

> Hi [Name], love [one specific thing about their brand].
>
> When a payment fails at checkout (bank timeout, low balance, expired card), most of those customers still want the product. I built a tool on top of Razorpay that shows you why each payment failed and sends that customer one payment link, only when you approve it.
>
> 60-second demo: [Loom link]
>
> I'm running free 30-day pilots for 5 stores. You only pay 8% of what comes back after that. Want to try it?

### 3. Follow-up (3 days after no reply). Most replies come from this one.

> Hey [Name], bumping this in case it got buried. Happy to just send you the 60-second video if that's easier.

### 4. Warm intro ask (to every pilot store and every friendly reply)

> Thanks for the time today! Do you know one or two other founders who sell online with Razorpay? I'd love an intro, and I'll set them up free just like you.

### 5. Converting a pilot to paid (day 25 of the pilot)

> Hi [Name], quick update from RecoverFlow: in the last [N] days it brought back [₹X] from [Y] customers whose payments had failed. The free month ends on [date]. After that it's 8% of what comes back, so on this month's numbers that would have been [₹fee] and you'd have kept [₹X − fee]. Shall I keep it running?

Fill the numbers from the **Weekly report** page (set it to 30 days). Print it to PDF and attach it.

## The 15-minute call

1. **Ask first (5 min).** "How do you handle failed payments today? Roughly how many a month? What do they usually cost you?"
2. **Show (5 min).** Open the demo. Show one case: why it failed, the safety check, the message preview, approve, then "Simulate customer paying" and the Recovered stamp.
3. **Close (5 min).** "Let's connect it to your Razorpay this week. It's free for 30 days, then 8% of what comes back, nothing if nothing does. Does Thursday work for a 20-minute setup call?"

## Answers to the usual worries

| They say | You say |
|---|---|
| "Will it spam my customers?" | One link per failed payment, only after you approve, never to anyone who hasn't agreed to be contacted. |
| "Do you touch my money?" | No. Customers pay you through your own Razorpay. I just invoice 8% at the end of the month. |
| "I don't have time." | Setup is a 20-minute call where I do it with you. After that it's a few taps a day. |
| "Razorpay already retries." | Retries don't tell the customer anything. A link with your store name gets the customer to finish the order. |
| "What if it doesn't work?" | Then you pay nothing. The pilot is free, and the fee only applies to money that actually came back. |

## Pilot setup checklist (on the call)

1. Create their workspace (see DEPLOY.md, step 5) with their `MERCHANT_NAME`.
2. They add the webhook in Razorpay with the six events, using the URL and secret you give them.
3. Press **Send a test failure** together. Confirm it appears.
4. They create live API keys; set them plus `RAZORPAY_MODE=live`.
5. Add their ops person as an approver on the Team page.
6. Agree a time each day for the first week when you both look at new cases.

## Week by week

| Dates | Daily target | Focus |
|---|---|---|
| Oct 18 | 5 advice messages | Just start |
| Oct 19 to 25 | 10 advice messages | Learn how stores talk about failed payments; book calls |
| Oct 26 to Nov 1 | 10 demo messages with the Loom | Calls and the first pilot |
| Nov 2 to 7 | 5 new messages plus every follow-up | Pilots 2 and 3, warm intros |
| Nov 8 to 9 | Conversion messages | Ask the best pilot to pay |
