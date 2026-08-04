# RUNBOOK — Take It or Leave It

**For Ad and Ta.** FR built this and will not be in the room on Day 3. Everything
needed to run the demo without an engineer is on this page.

---

## Start it

```bash
cd ~/dev/take-it-or-leave-it && npm run kiosk
```

Then open **http://localhost:3400**

That is the whole command. No environment variables, no API keys, no network. First
run takes about 40 seconds to build; after that it starts in a couple of seconds.

**Rehearse this at least once each, on the laptop that will be plugged in.** Both of
you, unaided, all four screens, before FR leaves.

### If it will not start

Port already in use — something is still running from an earlier session:

```bash
lsof -ti:3400 | xargs kill -9 && cd ~/dev/take-it-or-leave-it && npm run kiosk
```

Build fails or the page is blank:

```bash
cd ~/dev/take-it-or-leave-it && rm -rf .next && npm run kiosk
```

Pricing book missing (the app says so plainly):

```bash
cd ~/dev/take-it-or-leave-it && npm run book:compile
```

Nothing works and the clock is running — **demo from the tests**. They are real, they
run in three seconds, and they prove the engine:

```bash
cd ~/dev/take-it-or-leave-it && npm test
```

62 assertions against the real Acquirer Framework. Walk the judges through
`tests/engine.test.ts` — the golden cases are named in plain English.

---

## Demo data is on by default

The header shows a purple **DEMO DATA** chip and the pricing book version ends
`-demo`. **Every rate on screen is deliberately wrong** — scaled and jittered so a
recording or a screenshot cannot leak the real front-book rate card.

The *structure* is real: real regions, real verticals, real volume bands, real
approval thresholds, real sources. Only the numbers are shifted.

If you decide the judges should see real rates, and the room and any recording are
cleared for it:

```bash
cd ~/dev/take-it-or-leave-it && NEXT_PUBLIC_DEMO_MODE=false npm run kiosk
```

The chip disappears when you do. **Check which mode you are in before the screen goes
up.** Decide this on Day 1, not on stage.

---

## The five demo merchants

Load any of them with one click from the right-hand rail on screen 1. Expected
numbers below — if what you see differs, something is wrong and you should say so
rather than talk over it.

### With DEMO DATA on (the default)

| Merchant | Guidance | Band | Volume to CKO | Txns/mo | eMNR/mo | Approval at guidance |
|---|---|---|---|---|---|---|
| Northgate Apparel | **33.25 bps** | Cat 2 | £3,000,000 | 61,224 | £9,975 | none |
| Vantage Digital | **41.61 bps** | Cat 4 | $10,000,000 | 333,333 | $41,610 | none |
| Meridian Gaming (Gold) | **18.99 bps** | Cat 6 | €60,000,000 | 1,428,571 | €113,940 | Team Leader → Strategic Pricing → CEO |
| Andes Marketplace | **UNMAPPED** | — | — | — | — | Regional Leader + Deal Desk |
| Kestrel Studio | **UNMAPPED** | — | — | — | — | Regional Leader + Deal Desk |

### With real rates (`NEXT_PUBLIC_DEMO_MODE=false`)

| Merchant | Guidance | eMNR/mo |
|---|---|---|
| Northgate Apparel | 38.4 bps | £11,520 |
| Vantage Digital | 49.7 bps | $49,700 |
| Meridian Gaming (Gold) | 23.9 bps | €143,400 |

### What each one is for

- **Northgate Apparel** — the clean case. UK Retail, £3m/month, Cat 2. Use this one
  to walk the flow. Its £9,000 MMB implies 30 bps, so pulling the rate below that
  triggers the MMB conflict warning — a good unscripted-looking beat.
- **Vantage Digital** — 50% scope. Merchant does $20m/month, Checkout gets $10m, and
  the tool bands on *our* volume, not theirs. RTAU is on at a 5% attach rate, which
  is where the per-request maths shows.
- **Meridian Gaming** — Gold, and **already at the CEO even priced at guidance**,
  because $600k of cash incentives exceeds the $500k trigger. Also shows the QTC
  written-approval gate (Antoine or Guillaume) and that Gambling takes no high-risk
  uplift because it is already priced as a high-risk category.
- **Andes Marketplace** — LATAM. Not in the Acquirer Guidance at all. The tool
  refuses to produce a rate, shows what it searched for, and routes to Strategic
  Pricing. **Demo this on purpose.**
- **Kestrel Studio** — £400k/month, below the framework's $1m floor. Same refusal,
  different reason.

---

## Run of show — 5 minutes

| Time | Who | Beat |
|---|---|---|
| 0:00–0:40 | **Ta** | The wall. Thirteen tabs, eight PDFs, four systems, and two reps quote the same merchant differently. The problem is not the spreadsheet — it is that pricing truth is scattered and unversioned. |
| 0:40–1:40 | **Ta** | Load **Northgate Apparel**. Paste the plain-English line if the AI parse is live, otherwise click the demo card. Hit **Build the price**. Guidance take rate in under a second. |
| 1:40–2:30 | **Ad** | **Hover a source on the waterfall.** Highspot, the exact CSV line, the document date, the verbatim text. "Every number, back to a document." ← the AI-quality moment |
| 2:30–3:20 | **Ad** | Drag the slider down. Discount climbs, annual revenue at risk climbs, Regional Leader → CRO → **CEO** appears. Point out that above 25% the rep no longer sends the email — Strategic Pricing does. Then **Deal on a page** → **Copy email**. |
| 3:20–4:00 | **Ad** | Load **Andes Marketplace**. It refuses. "A tool that cannot say *I don't know* will eventually price a LATAM marketplace off a European retail row." |
| 4:00–4:40 | **Ad** | **Book** in the header. Version, sources, document dates, coverage gaps, what is not covered. Then the refresh pipeline: Glean finds, Claude extracts, a human approves the diff. Nothing merges itself. ← the scale points |
| 4:40–5:00 | **Ta** | ROI. Name what was cut and why. Phase 2 is CAT peer pricing. |

Say FR's absence out loud rather than working around it: *"FR built this in two
sessions and is not here — we are running it without them. That is the handoff test
any internal tool has to pass."*

---

## If something breaks mid-demo

Say what you see, then move. The tool's whole argument is that it shows its work, so
showing a flag is on-message, not off it.

- **A number looks wrong** — "That is flagged, and the flag is the point: the tool
  tells you when the source document does not reconcile." Then move on.
- **The screen goes blank** — refresh. State is saved in the browser, so you land back
  where you were.
- **The AI parse button is greyed out** — it is meant to be. No API key at demo time
  by design: the pricing engine does not need one. Click a demo merchant instead.
- **Print dialog opens over the demo** — Escape. Come back to it at the end.
- **Anything else** — go to the Book screen and talk about the pipeline. That section
  needs nothing but a page load.

FR: ☎️ **[FR — put your number here before you leave]**

---

## What to say if a judge asks

**"Are these real prices?"** In demo mode, no — deliberately obfuscated so a
recording cannot leak the rate card. The structure, bands and approval thresholds are
real, straight from the framework and the 27 July guidance email.

**"How do you keep it current?"** You do not, by hand. `npm run book:refresh` — Glean
finds each document, Claude extracts candidate rates with the verbatim line each came
from, and it writes a diff. A human reads the diff and runs `book:approve`. Nothing
merges itself. Eight documents today, eighty next quarter, same pipeline.

**"What if the guidance does not cover a deal?"** It refuses and routes. Load Andes
Marketplace.

**"Why not just ask an LLM for the rate?"** Because the same merchant would get two
different answers, you could not show where a basis point came from, and it would
break the moment auth flaked. Glean and Claude run at compile time; the runtime is
arithmetic, which is why it answers in under a second offline and answers the same
way twice.

**"Is it approved for real quoting?"** Not yet, and the app says so on every screen
until someone signs the book off. That banner is deliberate.

---

## Do not, on Day 3

- Do not run `npm run book:compile` — it resets the approval stamp and re-adds the
  unapproved banner.
- Do not edit `data/pricing-book.json` by hand.
- Do not turn off demo mode without deciding, together, that the room is cleared for
  real rates.
- Do not click **Mail** on the email panel with a live mail client open. **Copy email**
  is the safe button, and it is the primary one for a reason.
