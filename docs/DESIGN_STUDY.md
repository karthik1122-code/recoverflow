# Design study: 109 SaaS sites, Oct 2026

Captured headlessly at 1440×900 (first screen) plus full-page scrolls for 15. Sources: payments and fintech (Stripe, Mercury, Ramp, Brex, Wise, Paddle, Chargebee, Recurly, Adyen, Plaid, Airwallex, Modern Treasury, Column, Increase, Metronome, Orb, Polar, Lemon Squeezy), India (Razorpay, Cashfree, Juspay, CRED, Zerodha, Groww, Jupiter, Fi, Setu, Zoho Billing), direct competitors in failed-payment recovery (Churnkey, Churn Buster, FlyCode, Stunning, Paddle Retain, Baremetrics, Chargeflow), and the most-awarded product sites (Linear, Vercel, Framer, Attio, Notion, Figma, Granola, Cursor, Arc, Raycast, Posthog, Supabase, Railway, Copilot Money, Monarch, Superhuman, Pitch, HEY, Cosmos and ~50 more).

## What the best sites do that the first RecoverFlow redesign did not

| # | Pattern | Who does it | What RecoverFlow had |
|---|---|---|---|
| 1 | **Art direction, not decoration.** One world the brand lives in: cinematic landscape (Mercury), living gradient ribbon (Stripe), dark sculpture (CRED), tilted 3D pills on navy (Copilot), lime + photo collage (Granola) | Mercury, Stripe, CRED, Copilot, Granola, Ramp | Flat grey page, a card, no atmosphere |
| 2 | **Big display type at regular or light weight**, often a custom face or an editorial serif. Ramp 400, Stripe 300, Mercury 480, Linear 510; serifs at Churnkey, Paddle, Granola, Monarch | almost all top 20 | 800-weight grotesk, the most common template choice |
| 3 | **The product is the hero**, shown big, real and alive with real-looking numbers | Linear, Polar, Attio, Monarch, Metronome, Zerodha | Product only appeared below the fold as a screenshot |
| 4 | **The category's money picture.** Recovery tools show revenue going up once the product is switched on (Churnkey's MRR bars, FlyCode's recovered counter, Paddle's 1.4× dashboard, Stunning's "$13B recovered") | every recovery competitor | No chart of money coming back over time |
| 5 | **Proof**: logo strips, big totals, faces, awards | Stripe, Copilot, Stunning, Chargebee | None (honestly, none exists yet), and nothing in its place |
| 6 | **Rhythm**: full-bleed bands that change colour, big headline per section, bento grids of real UI fragments | Stripe, Ramp, Churnkey, Metronome, Monarch | Same-weight sections one after another |
| 7 | **Ambient motion** that keeps the page alive (flowing gradient, ticking counter, live feed) | Stripe, Linear, Flycode, Tinybird | One stamp animation, then still |
| 8 | **A local, owned idea** | CRED (club), Zerodha (calm trader), Groww (city), Jupiter (sky) | Generic paperwork |

## What top dashboards have (Linear, Attio, Mercury, Stripe, Superhuman)

- A greeting that leads with the outcome ("Good morning, Alex" + the one number that matters)
- Trend over time, not just totals
- Command palette (Ctrl/⌘ K) and single-key shortcuts (J/K to move, A to act, ? for help)
- Hover actions on rows, multi-select with a bulk action bar
- Filter chips, live "new" arrivals with a quiet notification
- The workspace's own name and identity in the sidebar

## The direction this produced

**Marigold.** In India, every merchant knows two sounds: the red "payment failed" screen, and the counter speaker that announces "₹2,499 received". RecoverFlow is that announcement for money you thought was gone. Marigold is the colour of shop openings and Diwali counters; ink blue is the merchant's ledger pen.

- Colour: marigold `#F4A51C` field, ink `#131A33`, white and fog surfaces, green for money back, red for failed, violet for held
- Type: Newsreader (editorial serif, regular weight) for display, Geist for interface and numbers
- Hero: a marigold band with a live announcement panel that you can **hear** (the browser speaks the recovery out loud, the way a counter speaker does)
- Signature chart: weekly failed money with the recovered share growing inside it
- Dashboard: greeting with today's number, 14-day recovered trend, ⌘K palette, keyboard shortcuts, bulk approve, reason filter chips, optional spoken announcements when money comes back
