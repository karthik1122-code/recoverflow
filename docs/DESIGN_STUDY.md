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

---

# Part 2: 108 award-winning sites, any industry (Oct 2026)

Sources: the current Awwwards Sites of the Day, six pages of CSS Design Awards Website of the Day winners, and all-time Site of the Year names (Lusion, igloo inc, Messenger by Abeto, Bruno Simon, Active Theory, Locomotive, Immersive Garden, Darkroom, Basement, Cuberto, Obys, Dogstudio, 14islands, Aristide Benoist). 157 were attempted; 108 loaded in a headless browser (the rest needed WebGL the sandbox couldn't run or blocked bots). Each was captured three times: the first second, after the pointer moved, and after scrolling, and its scripts, canvases, cursor, sound and type sizes were measured.

| Signal | Share of the 108 |
|---|---|
| First second is an intro, loader or empty stage | 50% |
| Custom cursor | 39% |
| Autoplay hero video | 39% |
| Smooth scrolling (Lenis, Locomotive) | 44% |
| WebGL canvas | 27% |
| Display type 120px or larger | 31% (18% at 200px+) |
| Sound control | 12% |
| Words on the page | median 394, a quarter under 95 |

## What they do

1. **Open with a moment.** A loader with a voice ("Loading the playlist… it might take some time", a terminal boot log, "Installing 1-bit charm"), or one control: BMW's site is a single START ENGINE button.
2. **One object you can touch.** Moto's metal card, Messenger's planet, Webdrift's synth and Mac, YAAS cans, GoalCard's sticker cards, Henrietta's snack mascot. The object is the brand.
3. **Type as image.** Wordmarks running edge to edge (Neutomni, Halaska, Mejuma, Casa Momo, Garcy), kinetic headlines (Darkroom, La Boîte à Slides).
4. **Scroll as story.** A scene pins and changes as you scroll, instead of sections stacking.
5. **Few words, one colour world.** Neutomni red, Hidokmeh yellow, Mild Sugar orange, YAAS candy.
6. **Craft in small things.** Cursors that label what you can do, sound toggles, honest humour in loaders.

## What RecoverFlow was missing

No entry moment; the speaker was a drawing, not something to play; sections still followed the SaaS order (hero, chart, cards, pricing, FAQ); far too many words.

## The stand-out idea: the soundbox

The most recognisable object in Indian retail is the UPI soundbox on the counter that says "₹2,499 received". RecoverFlow announces money that came back, so the site becomes a soundbox you play: a failed payment slides in, you press the button, the link goes out, and the box says "two thousand four hundred and ninety-nine rupees recovered" with a synthesised chime. None of the 109 product sites or 108 award sites does this, and it is exactly what the product does.

The speaker is drawn from scratch and carries no brand: generic rounded body, dotted grille, a small LCD and one round button.

- **Hero:** the soundbox on a dark counter, its LCD boots ("Connecting to Razorpay… 3 failed"), the visitor presses it. Sound is off until the first press.
- **Story:** a pinned scene processes one case in four scroll steps (reads the failure, checks it's safe, you approve one link, it closes itself when they pay).
- **Proof:** the two-week chart of failed money with the recovered share inside it.
- **Close:** a giant wordmark footer, 8% pricing and the founder's pilot letter.
- **Dashboard:** the same chime when a case is recovered.
