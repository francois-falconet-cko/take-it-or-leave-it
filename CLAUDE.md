# Take It or Leave It — working notes

Front-book pricing tool for Checkout.com Commercial. A rep describes a merchant and
gets the Acquirer Guidance take rate, the approval path, and a deal on a page.

Spec: `docs/PRD.md` (also in `~/dev/thrive2026/docs/take-it-or-leave-it/`).

## The one architectural rule

**Glean and Claude at compile time. Deterministic arithmetic at run time.**

```
Highspot PDFs ─┐
acq framework  ├─▶ Glean ─▶ Claude ─▶ pricing-book.json ─▶ pure TS engine ─▶ quote
guidance email ┘   (find)   (extract)  (versioned,          (no network,
                                        human-approved)      no LLM, no clock)
```

Do not add a network call, an LLM call, or a clock read anywhere under
`src/lib/engine/`. `price(intake, book, today)` is a pure function and the tests
depend on that. `today` is a parameter for exactly this reason.

The only runtime LLM call is `app/api/parse-merchant/route.ts`, which turns free
text into intake fields. It never sees the pricing book and its output is
allow-listed before it reaches the client, so it cannot introduce a rate.

## Take rate, defined

> **Total take rate = Acquirer Pay In % (core fee) + Other (add-on services)**

It scales with the merchant's **monthly** processing volume. Interchange and scheme
fees are pass-through and excluded. Source: Acquirer Guidance email, 27 Jul 2026.

## Things that look like bugs but are not

**The framework's `Total take rate` column is authoritative.** We never rebuild it
from Acquirer Pay In + Other. 43 of 855 rows have rounding in the Other column, so
recomputing would silently disagree with the document a rep is quoting from. The
gap shows as its own "Rounding in source document" line.

**VAS toggles do not change the target rate.** The guidance already carries expected
VAS and FX revenue inside its Other line — it is expressed as an *uplift percentage
on Acquirer Pay In*, not as itemised per-product fees. Adding Highspot list prices
on top would double-count. The toggles drive the *attach check*: does the selected
bundle plausibly deliver the uplift the framework assumes?

**A Gold deal at guidance still needs sign-off** (Team Leader + Strategic Pricing).
A non-Gold deal at guidance does not. "No discount" ≠ "no approval".

**Above 25% discount the rep stops owning the approval email.** Strategic Pricing
owns it, and the draft is addressed to them, not the CRO.

**Per-transaction fees are not basis points.** `bps = fee / ATV × 10_000`, and for
per-request fees multiply by the attach rate first. RTAU only fires on retried
transactions; charging it against 100% of volume overprices the deal by ~20×. This
is the most dangerous bug available in this codebase — `tests/engine.test.ts` guards
each conversion individually.

**LATAM is in the region dropdown on purpose.** The framework does not cover it, and
the tool needs to be able to say so rather than price it off an adjacent row.

## Confidentiality

- No pricing data leaves the machine at runtime. The engine is offline; fonts are
  self-hosted; there is no analytics package.
- `data/pricing-book.json` is gitignored. So are the CSV and the `.eml`. Recreate
  the book with `npm run book:compile`.
- `DEMO_MODE` defaults to **on** and loads `pricing-book.demo.json`, where every
  rate is deliberately wrong. Someone has to set `NEXT_PUBLIC_DEMO_MODE=false` to
  see real numbers. This is so a screen recording cannot leak the rate card.
- Nothing auto-sends email. The tool drafts; a human reads and sends.

## Style

- Dark UI only. Colours come from `src/lib/brand.ts` — never a raw Tailwind colour.
  Lime is good news, orange is escalation and warnings, purple is AI and gates.
- Headlines are uppercase with no trailing period (`.headline`).
- American English.
- Numbers get `.tnum` so columns line up.

## Commands

```bash
npm run dev            # port 3400
npm run kiosk          # build + serve, the demo-day command
npm test               # engine tests — the gate; nothing ships red
npm run typecheck
npm run book:compile   # acq framework CSV -> pricing-book.json (+ demo book)
npm run book:refresh   # Glean -> Claude -> pricing-book.diff.md (never merges)
npm run book:approve -- --by "Ad"
```

## Still open

Marked **⚠️ VERIFY** in the PRD, all of them config rather than code:

- Does the framework band on the merchant's total volume or on Checkout's share?
  This tool uses Checkout's share and flags when the two differ.
- "Any deal above $1B" — of what? Read here as annual TPV.
- The guidance pairs "over 50% discount" with "cash incentives above 500k" in one
  line. Read conservatively as either trigger reaching the CEO.
- Whether the Strategic Pricing exception also removes the Regional Leader step.
- 8 VAS list prices are placeholders pending extraction. They do not affect the
  guidance rate.
