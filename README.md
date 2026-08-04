# Take It or Leave It

**Front-book pricing on Acquirer Guidance.** A rep describes a merchant and gets
the recommended take rate, the approval path, and a deal on a page — in about
thirty seconds, offline, with every basis point traceable to the document it came
from.

Built for the Checkout.com Commercial AI Hackathon 2026.

---

## The problem

The brief called it a 13-tab spreadsheet problem. It isn't — the spreadsheet is a
symptom.

The actual problem is that **there is no single, versioned, queryable source of
truth for front-book price.** Guidance lives in a CSV, eight-plus Highspot PDFs, a
Confluence page, and an email from a leader. So every rep rebuilds the same model
from scattered inputs, each with a slightly different vintage of the truth, and
afterwards nobody can tell which numbers a quote was actually built from.

Automating the spreadsheet patches that. Building a governed source of truth and a
calculator that cites it makes the spreadsheet unnecessary.

---

## Quick start

```bash
npm install && npm run kiosk
```

Then open **http://localhost:3400**

No environment variables. No API keys. No network. Works with Wi-Fi off.

Five demo merchants load with one click from the intake screen — including two that
the guidance deliberately cannot price. Expected numbers for each are in
[RUNBOOK.md](RUNBOOK.md).

> **Demo mode is on by default.** Every rate you see is deliberately obfuscated so a
> screen recording can't leak the rate card. The structure — regions, verticals,
> volume bands, approval thresholds, sources — is real. Set
> `NEXT_PUBLIC_DEMO_MODE=false` for real rates.

---

## How it works

> **Glean and Claude at compile time. Deterministic arithmetic at run time.**

The obvious build is: rep fills a form → app asks Glean → an LLM reads the PDFs →
an LLM returns a take rate. That build fails on everything that matters. The same
merchant gets two different answers, you can't show where a basis point came from,
it takes 5–20 seconds, and it dies the moment auth flakes. So there are two
separate systems:

```
┌─ COMPILE TIME · weekly or on demand, human-approved ──────────────────┐
│                                                                       │
│  acq framework CSV ─┐                                                 │
│  Highspot PDFs      ├─▶ Glean ─▶ Claude ─▶ pricing-book.json          │
│  Guidance email ────┘   (find)   (extract,   (versioned, cited,       │
│                                   quote,      human-approved)         │
│                                   score)          │                   │
│                                                   ▼                   │
│                                    pricing-book.diff.md ─▶ a human    │
│                                                            approves   │
└───────────────────────────────────────────────────────────────────────┘
                                                    │
┌─ RUN TIME · what the rep touches ─────────────────▼───────────────────┐
│                                                                       │
│  Intake ─▶ price(intake, book, today) ─▶ take rate + citation trail   │
│            pure function · no network · no LLM · no clock             │
│                          │                                            │
│            ┌─────────────┴─────────────┐                              │
│            ▼                           ▼                              │
│         Accept                     Challenge                          │
│            └───────────┬───────────────┘                              │
│                        ▼                                              │
│            Deal on a page + drafted approval email                    │
└───────────────────────────────────────────────────────────────────────┘
```

This is also the answer to the hardest constraint in the brief — *prices change and
must stay current.* You don't maintain prices by hand. You re-run the compiler,
read a diff, and approve it. **Glean finds, Claude extracts, a human decides.**
Nothing merges itself.

One LLM call does stay at run time, and only here:
[`app/api/parse-merchant/route.ts`](app/api/parse-merchant/route.ts) turns a rep's
plain-English description into intake fields. It never sees the pricing book, and
its output is allow-listed before it reaches the client, so it cannot introduce a
rate. Without an API key the button greys out and the rest of the app is unaffected.

---

## The four steps

**1 · Merchant** — MCC resolves to a vertical live. Volume figures are cross-checked
against each other and flagged when they disagree by more than 15% annualized. Scope
of volume is a *number*, so a deal where Checkout gets half the volume prices as
half the volume. Per-request VAS get an editable attach-rate slider.

**2 · Guidance** — the take rate, decomposed line by line. Every row shows how the
source document phrases it, what that is in basis points, and a link to the document
with its exact locator, verbatim text and age. Alongside it, a **VAS attach check**:
does the selected bundle plausibly deliver the VAS and FX revenue the guidance
assumes?

**3 · Accept or challenge** — drag the rate and watch the discount, the annual
revenue at risk, and the approval chain move together. Escalation reads as colour.
The tool tells you when the Monthly Minimum Bill is the real price at the rate you
just asked for.

**4 · Deal on a page** — one printable page via the browser's own print-to-PDF, plus
a drafted approval email addressed to the right people. The tool drafts; a human
reads and sends. There is no auto-send path.

**Or it refuses.** If the guidance doesn't cover the merchant, the tool says so,
shows what it searched for, offers adjacent rows explicitly labelled as *not*
guidance, and routes to Strategic Pricing. It never approximates a rate from a
neighbouring row. Two of the five demo merchants exercise this on purpose.

---

## Commands

| | |
|---|---|
| `npm run dev` | Dev server on port 3400 |
| `npm run kiosk` | Build and serve — the demo-day command |
| `npm test` | 62 engine tests. The gate; nothing ships red |
| `npm run typecheck` | |
| `npm run book:compile` | Acquirer Framework CSV → `pricing-book.json` (+ demo book) |
| `npm run book:refresh` | Glean → Claude → `pricing-book.diff.md`. Never merges |
| `npm run book:approve -- --by "Ad"` | Sign off a compiled book |

`book:compile` needs `sources/acq framework.csv` present. It is gitignored along
with the guidance email — see [Confidentiality](#confidentiality).

---

## Layout

```
src/lib/engine/         The pricing engine. Pure functions, no I/O.
  normalize.ts            Volume, and fee units → basis points
  select.ts               Which guidance row applies
  variance.ts             Discount, eMNR, revenue at risk
  approvals.ts            The two approval ladders
  index.ts                price(intake, book, today) → Quote
src/lib/book.ts         Loads the pricing book. Demo-mode switch lives here.
src/lib/email.ts        Approval email generation
src/components/         The four screens, plus the shell and UI primitives
app/book/               Pricing book admin — version, sources, coverage, gaps
app/api/parse-merchant  The one runtime LLM call
data/pricing-book.json  The single artefact the runtime reads (gitignored)
scripts/                Compile, refresh, approve
tests/engine.test.ts    Golden cases against the real framework
sources/                Pricing sources and their config
```

---

## The data

Compiled from the Acquirer Framework CSV and the Acquirer Guidance email of
27 July 2026.

| | |
|---|---|
| Framework rows | **855 of 855** compiled, none skipped |
| Keyed on | region × vertical × country scope × risk level × monthly volume band |
| Regions | APAC, EEA, MENA, NORAM, UK — **no LATAM** |
| Verticals | 15 |
| Volume bands | 9, from $1m/month |
| Region × vertical gaps | **0** — every combination has a row |
| MCCs mapped | 52 |
| Sources tracked | 13 |
| VAS list prices pending extraction | 8 |

### Take rate, defined

> **Total take rate = Acquirer Pay In % (core fee) + Other (add-on services)**

It scales with the merchant's **monthly** processing volume. Interchange and scheme
fees are pass-through and excluded.

### Three things that look like bugs and are not

**The framework's `Total take rate` column is authoritative.** We never rebuild it
from its parts. **43 of the 855 rows don't reconcile** — `Acquiring + Other ≠ Total`
by up to 0.005pp, because the `Other` column is rounded in the source. Recomputing
would silently disagree with the document a rep is quoting from, so the difference
appears as its own "Rounding in source document" line instead.

**VAS toggles don't change the target rate.** The framework already carries expected
VAS and FX revenue inside its `Other` line, as an *uplift percentage on Acquirer Pay
In* rather than as itemised per-product fees. The guidance email confirms the
direction: *"moving away from per-product fees toward one overall customer take
rate."* Adding Highspot list prices on top would double-count. The toggles drive the
attach check.

**Per-transaction fees are not basis points.** `bps = fee / ATV × 10,000`, and for
per-request fees multiply by the attach rate first. RTAU only fires on retried
transactions — charging it against 100% of volume overprices a deal by roughly 20×.
Each conversion is guarded individually in the tests.

More of these in [CLAUDE.md](CLAUDE.md).

---

## Approvals

Two ladders, transcribed from the guidance email. The distinction matters: a Gold
deal priced exactly at guidance still needs sign-off; a non-Gold deal at guidance
doesn't.

| Discount | Non-Gold | Gold, or any deal above $1bn |
|---|---|---|
| At or above guidance | none | Team Leader + Strategic Pricing |
| up to 10% | Regional Leader | Team Leader + Strategic Pricing |
| 10–25% | Regional Leader | Regional Leader + Strategic Pricing |
| 25–50% | Regional Leader + CRO | Regional Leader + CRO |
| over 50% | CEO | CEO |

Plus three rules that are easy to miss and change the answer:

- **Above 25% discount the rep stops owning the approval email.** Strategic Pricing
  owns it, and the draft is addressed to them.
- **Gold and Tier 1 deals cannot be actioned in QTC** without written sign-off from
  Antoine or Guillaume, whatever the discount band says.
- **Cash incentives above $500k** reach the CEO on the Gold ladder independently of
  the discount.

Free processing and VAS free trials run their own ladder alongside the discount one —
a deal can be in line on take rate and still need the CRO because someone promised
four months free.

The whole matrix lives in `pricing-book.json` as config, not in code, so correcting
it is a JSON edit.

---

## Confidentiality

- **No pricing data leaves the machine at run time.** The engine is offline, fonts
  are self-hosted, there is no analytics package.
- `data/pricing-book.json`, the framework CSV and the guidance email are all
  **gitignored**. Recreate the book with `npm run book:compile`.
- `DEMO_MODE` defaults to **on** and loads `pricing-book.demo.json`, where every rate
  is deliberately wrong. Someone has to opt in to see real numbers.
- Until a human signs the book off, every screen carries an **unapproved pricing
  book** banner. That is deliberate.
- Nothing auto-sends email.

---

## Status

Verified: 62 engine tests green, typecheck and production build clean, all four
screens walked end to end in the browser, runs with zero env vars and the network
off.

**Open — all of it config rather than code**, and all listed with context in
[§0.3 of the PRD](docs/PRD.md):

1. Does the framework band on the merchant's **total** volume or on Checkout's
   **share**? The engine uses our share and flags when the two differ. Worth five
   minutes with Strategic Pricing.
2. *"Any deal above $1B"* — of what? Read as annual TPV.
3. The guidance pairs *"over 50% discount"* with *"cash incentives above 500k"* on one
   line. Read conservatively as either trigger reaching the CEO.
4. Does the Strategic Pricing exception also remove the Regional Leader step?
5. The framework CSV carries no revision date. Dated to the guidance rollout and
   flagged `inferred` in the UI.
6. Eight VAS list prices are placeholders pending extraction. They do not affect the
   guidance rate — paste the Highspot text into `sources/raw/` and re-run
   `book:refresh`. Format in [sources/raw/README.md](sources/raw/README.md).

**Phase 2:** peer pricing from CAT (`client-admin.cko-prod.ckotech.co/web/nas/`) to
set the guidance rate against what comparable merchants in the same vertical and
region actually pay. Needs VPN access and a data-access review; stubbed in the UI and
deliberately out of scope.

---

## Docs

| | |
|---|---|
| [RUNBOOK.md](RUNBOOK.md) | Demo-day operations. Expected numbers per merchant, run of show, what to say when something breaks |
| [CLAUDE.md](CLAUDE.md) | Working notes — the architectural rules and the non-obvious behaviours |
| [docs/PRD.md](docs/PRD.md) | Product requirements. §0 records what the real source data changed |
| [docs/BUILD-PROMPT.md](docs/BUILD-PROMPT.md) | The staged prompts this was built from |
| [sources/raw/README.md](sources/raw/README.md) | How to paste pricing sources for the refresh pipeline |

---

## Team

Ad (Sales Manager) · FR (Implementation Engineer) · Ta (Sales)

Built across two four-hour sessions. FR is not present on demo day, which is why
`npm run kiosk` is one command with no arguments and why
[RUNBOOK.md](RUNBOOK.md) exists — the handoff test any internal tool has to pass.
