# Take It or Leave It — Product Requirements Document

**Commercial AI Hackathon 2026 · Checkout.com**
**Version:** 1.0 · **Date:** 2026-08-04 · **Status:** Draft for Day 1 sign-off

| | |
|---|---|
| **Team** | Ad (Sales Manager) · FR (Implementation Eng) · Ta (Sales) |
| **Build budget** | 3 slots × 4h. **FR is present for slots 1–2 only.** Effective engineering time: **~8h.** |
| **Mandated tools** | Claude Code, Glean |
| **Scored on** | 10 pts AI output quality · 10 pts demo/pitch · 5 pts scale |

---

## 0. Status — read this before the rest

> **This section supersedes anything below it that contradicts it.**
>
> The rest of the PRD was written *before* the Acquirer Framework CSV and the guidance email could be read. Both have since been read, and both changed the design in ways worth being explicit about. **§5.4 and §6.3 below are wrong.** They are left in place because the reasoning is still useful and because the delta is the interesting part — but build against this section and against the code.

**Built and verified as of 2026-08-04:** intake, engine, guidance screen, challenge, deal on a page, email, pricing book screen, Glean refresh pipeline. 62 engine tests green. Typecheck and production build clean. Runs offline with zero env vars. See [RUNBOOK.md](../RUNBOOK.md).

### 0.1 What the real data changed

| What the PRD assumed | What the sources actually say | Consequence |
|---|---|---|
| VAS are itemised per-product fees **added** to acquiring (§5.4) | The framework expresses VAS + FX as an **uplift percentage on Acquirer Pay In**, already inside its `Total take rate`. The email confirms the direction: *"moving away from per-product fees toward one overall customer take rate"* | Guidance total comes from the framework's own column. VAS toggles drive a **reconciliation check**, not the target. Adding list prices on top would double-count |
| Approval bands at 5% / 15% (§6.3) | **25% / 50%**, and there are **two ladders** — non-Gold, and Gold-or-above-$1bn which needs sign-off even at guidance | Rewritten. Two ladders, cash-incentive trigger, QTC gate, SP routing threshold |
| Escalate on variance and absolute dollars | Escalate on **discount % only**, with cash incentives as a separate Gold trigger | Dropped the revenue-at-risk band. Kept revenue at risk as the headline *number* — it is what an approver reacts to |
| Bands might be annual or monthly volume | **Monthly**, confirmed verbatim: *"the total take rate, which scales with the merchant's monthly processing volume"* | Resolved |
| Regions: Europe / NORAM / APAC / LATAM | **APAC, EEA, MENA, NORAM, UK.** No LATAM | LATAM kept in the dropdown deliberately, as the refusal case |
| A separate `floor_bps` column | There is none | Floor concept dropped. The MMB-implied floor (§5.6) survives and does real work |

Two things the PRD got right and the data confirmed: per-transaction fees needing ATV conversion (the VAS one-pagers do price per transaction — that is why the reconciliation check is worth having), and the variance sign guard.

### 0.2 What the framework actually looks like

855 rows, keyed on **region × vertical × country scope × risk level × monthly volume band**.

- 5 regions, 15 verticals, 9 volume bands from $1m/month
- Country overrides *inside* regions: `FRIT` and `SEU` in EEA, `United States` in NORAM, `United Arab Emirates` in MENA. A merchant with no scope named must never be priced off the FRIT row
- Columns: `Average Take Rate Acquiring Pay IN`, `Other take Rate`, `VAS fees + Other` (%), `% Fx` (%), **`Total take rate`**, `Average ATV`, `High risk ADD`
- The arithmetic is `Other = Acquiring × (VAS% + FX%)`, so `Total = Acquiring × (1 + VAS% + FX%)` — but **43 of 855 rows do not reconcile** because the `Other` column is rounded. The engine therefore treats `Total take rate` as authoritative and shows the gap as its own line rather than silently recomputing
- High risk: `+15%` on the standard total, except in verticals already priced as high risk (Crypto, Gambling) which are marked *"High risk category no additions"*
- Coverage gaps at region × vertical level: **zero**. Every combination has a row, which is good news worth stating

### 0.3 Still genuinely open — all config, not code

1. Does the framework band on the merchant's **total** volume or on **Checkout's share**? The engine uses Checkout's share and flags when the two differ.
2. *"Any deal above $1B"* — of what? Read as annual TPV.
3. The guidance pairs *"over 50% discount"* with *"cash incentives above 500k"* on one line. Read conservatively as **either** trigger reaching the CEO.
4. Does the Strategic Pricing exception also remove the Regional Leader step?
5. The framework CSV carries no revision date. Dated to the guidance rollout (2026-07-27) and flagged `inferred` in the UI. Ask Strategic Pricing for the real one.
6. Eight VAS list prices are placeholders pending extraction. They do not affect the guidance rate.

---

## 1. The problem, restated

The brief says the problem is a 13-tab spreadsheet. It isn't. The spreadsheet is a symptom.

The actual problem: **Checkout.com has no single, versioned, queryable source of truth for front-book price.** Guidance lives in a CSV, eight-plus Highspot PDFs, a Confluence page, and an email from a leader. So every rep rebuilds the same model from scattered inputs, each with a slightly different vintage of the truth, and nobody can tell afterwards which numbers a quote was built from.

That reframe matters for scoring ("*Is it rethinking how we operate AI-first — not just patching a bad process?*"). Automating the spreadsheet patches the process. Building a governed source of truth and a calculator that cites it makes the spreadsheet **unnecessary**.

**Three consequences we design for:**

1. **Speed** — hours-to-days per quote becomes under a minute.
2. **Consistency** — two reps, same merchant, same number. Today they don't get one.
3. **Auditability** — every bp on screen traces to a document, a version, and a date. This is what lets Commercial actually adopt it. A tool that produces a confident number with no provenance will not survive first contact with a CRO.

---

## 2. The core architectural decision

> **Glean at compile time. Deterministic arithmetic at run time.**

The obvious build is: rep fills a form → app asks Glean → LLM reads the PDFs → LLM returns a take rate. **Do not build this.** It fails on all four things that matter:

| | LLM-at-runtime | Compile-time pipeline |
|---|---|---|
| Same input, same answer? | No | Yes — pure function |
| Time to answer | 5–20s, variable | <50ms |
| Can you show where a bp came from? | Post-hoc, unreliable | Exact doc + row + date |
| Demo survives flaky auth / no network? | No | Yes |
| Confidential rates leave the machine? | Every request | Never at runtime |

**So:** two separate systems.

```
┌─ COMPILE TIME (runs weekly, or on demand, human-approved) ────────────┐
│                                                                       │
│  Highspot PDFs ─┐                                                     │
│  acq framework  ├─▶ Glean ─▶ Claude extraction ─▶ pricing-book.json   │
│  Confluence ────┤   (find +   (structured,        (versioned,         │
│  Guidance email ┘    fetch)    cited, quoted)      human-approved)    │
│                                        │                              │
│                                        ▼                              │
│                            pricing-book.diff.md ──▶ Ad/Ta approve     │
└───────────────────────────────────────────────────────────────────────┘
                                        │
┌─ RUN TIME (what the rep touches) ──────▼──────────────────────────────┐
│  Intake form ─▶ pure TS engine ─▶ Target TR + full citation trail     │
│                (no network, no LLM, unit-tested)                      │
│                       │                                               │
│                       ▼                                               │
│  Accept ──▶ Deal on a Page                                            │
│  Challenge ─▶ variance + approval chain ─▶ drafted email              │
└───────────────────────────────────────────────────────────────────────┘
```

This is also the answer to *"how do we keep prices up to date?"* — the hardest constraint in the brief. You don't maintain prices by hand. You re-run the compiler, read a diff, and approve it. **Glean's job is to find and read; Claude's job is to extract and diff; a human's job is to approve.** Nothing merges itself.

**One LLM call does stay at runtime**, and only here: turning the rep's plain-English merchant description into structured intake fields (§4.3), and writing the justification prose in the approval email. Neither touches a price. Keep that boundary clean and you can state it plainly to judges.

---

## 3. Scope

### 3.1 In scope (must ship by end of Day 2)

| # | Capability | Why it's non-negotiable |
|---|---|---|
| M1 | Intake form, all fields in §4 | Entry point |
| M2 | Deterministic pricing engine with unit normalization (§5.4) | **The product.** Without §5.4 the numbers are wrong |
| M3 | Target TR with a per-line citation breakdown | The trust story; the demo's best moment |
| M4 | Accept / Challenge with live variance, eMNR, revenue-at-risk | Step 3 of the brief |
| M5 | Approval chain routing (§6.3) | Step 3 of the brief |
| M6 | Deal on a Page + print-to-PDF | Step 4 of the brief |
| M7 | Approval email draft + copy-to-clipboard | Step 4 of the brief |
| M8 | `pricing-book.json` v1 covering the demo's ground | Data floor |
| M9 | Glean → Claude compile script producing a reviewable diff | **The scale story.** 5 pts live here |
| M10 | Pricing Book screen: version, sources, dates, coverage gaps | Cheapest credibility in the build (~30 min) |
| M11 | `RUNBOOK.md` + `npm run kiosk` — demo runs with FR absent | Team constraint (§8.4) |

### 3.2 Explicitly out of scope — say this out loud on Day 3

Naming your cuts reads as judgment. Hiding them reads as an unfinished build.

- **CAT / VPN peer pricing** (`client-admin.cko-prod.ckotech.co`) — Phase 2. Ship a stubbed panel with the real value proposition written in it, clearly labelled Phase 2. Do not attempt VPN work in a hackathon.
- **PDF generation library** — browser print-to-PDF via `@media print`. Saves ~1h, output is fine.
- Auth, SSO, multi-user, persistence beyond `localStorage`.
- Salesforce read or write.
- Live FX — static table in the pricing book, stamped with an `as_of` date.
- **Actually sending email.** The tool drafts; the human sends. Never wire an auto-send.
- Full 13-tab parity. We replace the *pricing decision*, not every tab.

### 3.3 Success criteria

| | Target |
|---|---|
| Cold start → Deal on a Page | **< 60 seconds** (time this on Day 2, it's a pitch number) |
| Golden test cases matching a manual model | **5 of 5**, within ±1 bp |
| Priced line items carrying a source citation | **100%** |
| Demo runs with no network and no env vars | Yes |
| Day 3 demo delivered without FR | Yes |

---

## 4. Step 1 — Intake

### 4.1 Fields

Engine-critical fields are marked ●. Everything else is display-only — build the ● ones first.

**Merchant**

| Field | Type | Notes |
|---|---|---|
| Merchant name | text | Required |
| Merchant URL | text | |
| ● MCC | text + autocomplete | Drives vertical via `mcc_map`. Show the resolved vertical immediately so the rep can catch a bad MCC |
| ● Vertical | select | Auto-filled from MCC, rep-overridable. Log the override — it's a signal the MCC map needs work |
| ● Entity / region | select | Europe, North America, APAC, LATAM ⚠️ VERIFY against the CSV's real granularity — if it keys on country or legal entity, this becomes a country picker |
| ● Risk tier | select | Low / Standard / High. ⚠️ VERIFY: does the framework price on risk? The brief mentions risk as an input |
| Current acceptance rate | % | Display + pitch fodder |
| Platform | select | Shopify, Magento, BigCommerce, Salesforce, Adobe, Custom, Other |
| Current provider(s) | text | Goes in the email |

**Volume & deal shape**

| Field | Type | Notes |
|---|---|---|
| ● Currency | select | USD, EUR, GBP |
| ● ATV | number | **Required.** Every per-transaction fee is meaningless without it (§5.4) |
| ● Monthly TPV | number | |
| 3-month TPV | number | Cross-check, not primary |
| ● Annual TPV | number | Fallback |
| ● Scope of volume % | number, default 100 | See 4.2 |
| Scope note | text | e.g. "cards only, EU entity, phase 1" |
| Contract term | text | Email field |
| ● Monthly Minimum Bill | number | Implies a floor (§5.6) |

**VAS toggles** — each with an editable attach rate (§5.4, and it is the difference between a right and a wrong number):

Network Tokens · RTAU · Forward API & Vault · Integrated Platforms · Settlement Fees · Fraud Detection · Authentication (3DS) · APMs

### 4.2 Scope of volume must be a number

The brief models scope as free text ("50% of processing volume initially"). Free text cannot be multiplied. Split it: a numeric `scope_pct` the engine uses, and a text note for the email. Otherwise every eMNR figure the tool produces overstates revenue by whatever fraction of volume the merchant isn't actually giving us — the most common way a real quote is wrong.

### 4.3 The one runtime LLM call: "Describe it in plain English"

A textarea plus a **Parse** button. Rep pastes *"UK fashion retailer on Shopify, roughly £4m a month, £65 average basket, currently with Adyen, wants 3DS and network tokens"* → Claude returns structured JSON → fields populate, highlighted as AI-filled, all editable.

This is the brief's *"in plain fields or plain English"* and it demos beautifully. Constraints: strict JSON schema out; **it may not touch prices, rates, or approval routing**; every parsed field stays editable; nothing submits without the rep confirming. Build it last — it is the most impressive 30 minutes in the build and also the most droppable.

### 4.4 Volume sanity check (free credibility)

If two or more of monthly / 3-month / annual TPV are supplied and disagree by more than 15% once annualized, show a non-blocking warning naming both figures. Fat-fingered volume is the #1 error in the spreadsheet this replaces. Catching it is a 10-line function and a good demo beat.

---

## 5. Step 2 — The pricing engine

### 5.1 Define Take Rate before you write a line of code

> **Take Rate (bps) = Checkout.com net revenue ÷ merchant TPV × 10,000**

Under IC++, interchange and scheme fees are pass-through and **excluded**. TR is the "++": our margin. Put this definition in the UI as a tooltip. Half of all pricing arguments are actually definition arguments, and a tool that's silent on its own definition inherits the argument.

### 5.2 Pricing Book schema

`pricing-book.json` — the single artifact the whole runtime reads. Committed, versioned, diffable, human-approved.

```jsonc
{
  "version": "2026-08-05.1",
  "generated_at": "2026-08-05T09:14:00Z",
  "generated_by": "compile-pricing-book v1 (glean+claude)",
  "reviewed_by": "Ad",              // null = NOT approved; UI must warn
  "reviewed_at": "2026-08-05T09:40:00Z",

  "fx": { "base": "USD", "as_of": "2026-08-01", "rates": { "EUR": 1.09, "GBP": 1.27 } },

  "sources": [{
    "id": "src_acq_framework",
    "title": "Acquirer Framework (per market and vertical)",
    "system": "Highspot",                  // Highspot | Confluence | Drive | Email | CSV
    "url": "https://checkout.highspot.com/items/...",
    "doc_updated_at": "2026-06-12",        // vintage of the DOC — drives staleness
    "retrieved_at": "2026-08-05T09:12:00Z",
    "retrieved_via": "glean"               // glean | manual
  }],

  "mcc_map": [{ "mcc": "5651", "vertical": "Retail — Apparel", "risk_default": "low" }],

  "acquiring": [{
    "id": "acq_eu_apparel_t1",
    "region": "Europe", "vertical": "Retail — Apparel", "risk": "*",
    "tpv_band": { "min": 0, "max": 5000000, "currency": "USD" },
    "target_bps": 45,
    "floor_bps": 32,
    "source_id": "src_acq_framework",
    "source_locator": "row 27, col 'EU Tier 1'",
    "verbatim": "EU / Apparel / <5m: 45bps (floor 32)",   // audit trail
    "confidence": "high"                                   // high | medium | low
  }],

  "gateway": [{
    "id": "gw_eu_t1", "region": "Europe",
    "tpv_band": { "min": 0, "max": 5000000, "currency": "USD" },
    "per_txn": { "amount": 0.05, "currency": "USD" },
    "acquirer_premium_bps": 5,
    "source_id": "src_gateway_premium", "source_locator": "p.3 table 2",
    "confidence": "high"
  }],

  "vas": [{
    "key": "network_tokens", "label": "Network Tokens",
    "region": "*",
    "unit": "per_txn",                    // bps | per_txn | per_request | monthly_flat | pct_of_value
    "amount": 0.01, "currency": "USD",
    "default_attach_rate": 1.0,           // fraction of txns the fee applies to
    "source_id": "src_vas_network_tokens", "source_locator": "'Pricing' section",
    "confidence": "high",
    "notes": "Per tokenized transaction."
  }],

  "approval_matrix": { /* §6.3 */ },

  "coverage_gaps": [
    { "region": "LATAM", "vertical": "Marketplace", "reason": "not present in framework CSV" }
  ]
}
```

Two schema choices carry real weight:

- **`verbatim`** — the quoted source line for every rate. It is how Ad or Ta audits an extraction in three seconds instead of reopening a PDF, and it is the thing that makes the compile step trustworthy enough to run unattended.
- **`coverage_gaps`** — an explicit list of what guidance does *not* cover. A tool that knows what it doesn't know is a different class of product from one that guesses (§5.7).

### 5.3 Selection order

For each of acquiring / gateway / each enabled VAS:

1. Filter to rows matching region (exact, else `*`), vertical (exact, else `*`), risk (exact, else `*`).
2. Filter to the TPV band containing effective monthly TPV, converted to the band's currency via `fx`.
3. **Most specific wins** — score `region + vertical + risk` matches, exact beats wildcard, highest score takes it.
4. Zero matches → do not guess. Emit an `UNMAPPED` finding and route per §5.7.
5. Ties → pick the lower `target_bps`, and surface a warning. Quoting the cheaper of two ambiguous rates is the recoverable error; quoting the dearer one loses the deal.

### 5.4 Unit normalization — this is the magic in Step 2

> ⚠️ **Superseded by §0.1.** The framework carries VAS and FX as an uplift percentage inside its own `Total take rate`, so this build-up is **not** how the target rate is produced. The conversion table below is still exactly right, and still implemented in `src/lib/engine/normalize.ts` — it drives the **VAS attach check**, which asks whether the selected bundle plausibly delivers the uplift the framework assumes. Read it as that.

Every fee becomes bps-on-TPV. This section is the technical heart of the product; the brief's original spec ("sum of selected VAS bps additions") assumes all VAS are quoted in bps. **Most aren't** — Network Tokens, RTAU, 3DS and Vault are per-transaction or per-request. Summing them as bps produces a number that is wrong by an order of magnitude.

```
monthly_tpv_eff  = effectiveMonthlyTpv()          // §5.5
billable_tpv     = monthly_tpv_eff × scope_pct/100
monthly_txns     = billable_tpv / ATV
```

| `unit` | → bps | Note |
|---|---|---|
| `bps` | `amount` | |
| `per_txn` | `amount / ATV × 10_000` | Currency-converted first |
| `per_request` | `amount × attach_rate / ATV × 10_000` | **Attach rate is mandatory** |
| `monthly_flat` | `amount / billable_tpv × 10_000` | Scales down as volume grows |
| `pct_of_value` | `amount × 100` | 0.35% → 35 bps |

**Attach rate deserves its own paragraph.** RTAU only fires on the subset of transactions that fail and get retried. 3DS only on the subset that gets challenged. Charging those fees against 100% of transactions overprices the deal badly enough to lose it. Every `per_request` VAS gets a `default_attach_rate` in the book and a rep-editable override in the UI, and the override is a live slider in the demo. It shows the tool models the business, not just a spreadsheet.

```
target_bps = acquiring.target_bps
           + gateway.acquirer_premium_bps
           + toBps(gateway.per_txn)
           + Σ toBps(vas_i)
```

Return a `PriceLine[]`, never a bare number:

```ts
type PriceLine = {
  key: string; label: string;
  category: 'acquiring' | 'gateway' | 'vas' | 'settlement';
  rawUnit: Unit; rawAmount: number; rawCurrency: string;
  attachRate?: number;
  bps: number;                  // normalized
  sourceId: string; sourceLocator: string; verbatim: string;
  confidence: 'high'|'medium'|'low';
  docUpdatedAt: string;
};
```

The UI renders this array directly as the waterfall. Provenance is a property of the calculation, not a lookup bolted on after.

### 5.5 Effective monthly TPV

```
if (monthlyTpv > 0)        return monthlyTpv
if (threeMonthTpv > 0)     return threeMonthTpv / 3
if (annualTpv > 0)         return annualTpv / 12
throw BlockingError('Volume required')
```

### 5.6 Floor, and the MMB floor

- `floor_bps` — the guidance floor from `acquiring`, plus gateway and VAS at their floor or target. Below it, escalation is automatic and maximal.
- **MMB-implied floor:** `mmb_floor_bps = MMB / billable_tpv × 10_000`. If a requested TR prices below the MMB, the MMB is the real price and the quote is internally inconsistent. Show both; flag the conflict. A rep discovering this in month two of the contract is a bad day.

### 5.7 When there's no guidance

If step 5.3 finds nothing for the region × vertical combination, the tool must **refuse to produce a target rate**. It shows:

- What it looked for and which sources it searched
- The nearest adjacent rows it *did* find, clearly labelled as adjacent and not guidance
- A route: Regional Leader + Deal Desk for a bespoke quote
- A one-click "add to coverage gaps" that appends to the book's `coverage_gaps`

Refusing well is a feature. It is also, concretely, how you avoid the tool confidently pricing a LATAM marketplace deal off a European retail row.

### 5.8 Staleness

Per line: `days_since = today − docUpdatedAt`.

| Age | Treatment |
|---|---|
| ≤ 30d | Green |
| 31–90d | Amber badge |
| > 90d | Red badge + banner: "Pricing sources are stale. Run refresh before quoting." |

Book-level: if `reviewed_by` is null, a persistent banner reads **"Unapproved pricing book — not for external quoting."**

---

## 6. Step 3 — Accept or Challenge

### 6.1 Variance

```
variance_pct = (target_bps − requested_bps) / target_bps × 100
```

Positive = discount below guidance. Negative = premium above it.

| Edge case | Behaviour |
|---|---|
| `target_bps <= 0` | Block. Cannot compute variance |
| `requested_bps <= 0` | Block. Invalid request |
| `requested_bps >= target_bps` | **Variance ≤ 0 → no approval needed.** Show "At or above guidance — no sign-off required" |
| `requested_bps < floor_bps` | Below-floor path, always maximal escalation |

That third row is a correction to the brief's spec, which routes *"Variance < 5% → Regional Sales Leader"* — literally true of −40% variance, i.e. a rep pricing well *above* guidance would be sent to chase a signature they don't need. Guard the sign.

### 6.2 Revenue at risk — the number the approver actually wants

```
annual_revenue_at_risk = (target_bps − requested_bps)/10_000 × billable_tpv × 12
expected_eMNR_monthly  = billable_tpv × requested_bps / 10_000
expected_eMNR_annual   = expected_eMNR_monthly × 12
mmb_coverage           = MMB / expected_eMNR_monthly    // >1 means MMB binds
```

No CRO approves a percentage. They approve dollars. Put `annual_revenue_at_risk` at the top of the email and in the largest type on the challenge screen.

### 6.3 ~~⚠️ VERIFY~~ — Approval matrix (SUPERSEDED)

> ⚠️ **Wrong. Superseded by §0.1 and by `data/pricing-book.json` → `approval_matrix`.** The real bands are 25% / 50%, on two separate ladders. Kept below because the *shape* of the reasoning — bands as config not code, cumulative chains, half-open intervals, a binding reason per approver — all survived contact with the real document. The numbers did not.

**Everything in this table was a placeholder pending the `.eml`.** It ships in `pricing-book.json` as config, not as code, so correcting it on Day 1 is a JSON edit and not a rebuild.

Escalation is **two-dimensional** — variance *and* absolute dollars — because 20% variance on $50k/month is a rounding error and 3% on $50m/month is a board conversation. Take the **higher** band of the two.

| Variance | Annual revenue at risk | Approver |
|---|---|---|
| ≤ 0% | any | None — rep proceeds |
| 0 – 5% | < $250k | Regional Sales Leader |
| 5 – 15% | < $1m | + CRO |
| > 15% | any | + CEO |
| any | ≥ $250k | + CRO (floor override) |
| any | ≥ $1m | + CEO (floor override) |
| Below `floor_bps` | any | + CEO |
| `UNMAPPED` | any | Regional Leader + Deal Desk |

**Chain, not single approver.** The brief says *"Regional Leader → CRO → CEO"*, which is a sequence. Render the full chain with the binding reason next to each name: *"CRO — 8.2% variance"*, *"CEO — $1.4m annual revenue at risk"*. Bands are half-open `[min, max)`; state that in code so 5.0% has exactly one answer.

Config shape:

```jsonc
"approval_matrix": {
  "currency": "USD",
  "variance_bands": [
    { "min_pct": 0,  "max_pct": 5,    "approvers": ["Regional Sales Leader"] },
    { "min_pct": 5,  "max_pct": 15,   "approvers": ["Regional Sales Leader", "CRO"] },
    { "min_pct": 15, "max_pct": null, "approvers": ["Regional Sales Leader", "CRO", "CEO"] }
  ],
  "value_bands": [
    { "min_annual_risk": 250000,  "approvers": ["Regional Sales Leader", "CRO"] },
    { "min_annual_risk": 1000000, "approvers": ["Regional Sales Leader", "CRO", "CEO"] }
  ],
  "below_floor_approvers": ["Regional Sales Leader", "CRO", "CEO"],
  "unmapped_approvers": ["Regional Sales Leader", "Deal Desk"],
  "reason_categories": ["Competitive Threat", "Strategic Account", "Volume Commitment", "Executive Mandate", "Migration / Displacement"]
}
```

### 6.4 Challenge UI

Slider (floor − 20% … target + 20%) plus a numeric input. On every change, recompute live: variance %, expected eMNR, annual revenue at risk, approval chain, MMB conflict. Reason category is required. Justification textarea required, minimum ~40 characters, with an optional **"Draft with AI"** that expands the rep's bullets into prose using the deal's own numbers.

The slider is the demo's emotional beat: drag it down, watch **CEO** appear. Make that transition visible — colour shift, the new approver animating in. That single interaction communicates the whole product.

---

## 7. Step 4 — Outputs

### 7.1 Deal on a Page

One screen, print-clean, no scrolling on a 1440×900 projector:

1. **Header** — merchant, URL, MCC → vertical, region, date, rep
2. **Verdict strip** — Target TR · Requested TR · Variance % · approval chain badge
3. **Money** — billable monthly TPV, monthly txns, expected eMNR (monthly + annual), MMB, annual revenue at risk
4. **Waterfall** — every `PriceLine`: label, raw unit as quoted, attach rate, normalized bps, source link, staleness dot
5. **Justification** — category + prose
6. **Provenance footer** — pricing book version, `reviewed_by`, source count, oldest document date
7. **Phase 2 panel** — CAT peer pricing, greyed, labelled

Export: `window.print()` with a real `@media print` stylesheet. Filename via `document.title = "DealOnAPage_<Merchant>_<date>"`.

### 7.2 Approval email

Template as specified in the brief, with revenue-at-risk added because it's what gets a reply:

```
Subject: Frontbook Approval Request: {{merchant}} — {{requested_bps}} bps ({{variance_pct}}% vs guidance)

Hi {{approver_first_names}},

I am requesting {{requested_bps}} bps Take Rate for {{merchant}}, which is
{{variance_pct}}% below the recommended {{target_bps}} bps. This requires
approval from {{approver_chain}}.

Annual revenue at risk vs guidance: {{currency}}{{annual_revenue_at_risk}}

{{reason_category}} — {{justification}}

Merchant information:
  Platform:                  {{platform}}
  MCC / vertical:            {{mcc}} — {{vertical}}
  Region / entity:           {{region}}
  Annual revenue (TPV):      {{currency}}{{annual_tpv}}
  Current provider(s):       {{current_providers}}
  Scope of volume:           {{scope_pct}}% — {{scope_note}}
  Contract term:             {{contract_term}}
  Monthly Minimum Bill:      {{currency}}{{mmb}}
  Expected eMNR (monthly):   {{currency}}{{emnr_monthly}}
  Expected eMNR (annual):    {{currency}}{{emnr_annual}}

Pricing basis: {{pricing_book_version}} ({{source_count}} sources, oldest {{oldest_source_date}})

Please let me know if you require any additional information.

Best,
{{rep_name}}
```

**Copy to clipboard is the primary action.** `mailto:` is secondary and guarded — several clients truncate around 2,000 characters, and a silently truncated approval email is worse than no button. If the body exceeds the limit, disable `mailto:` with a tooltip pointing at Copy.

**No auto-send, ever.** The tool drafts; the human reads and sends. Say this on Day 3 — it is the kind of restraint that reads as commercial-ready.

---

## 8. Technical design

### 8.1 Stack: Next.js, not Streamlit

The brief offers either. Take Next.js — and specifically, **lift the design system already sitting in `~/dev/thrive2026`**:

- `src/lib/brand.ts` — Checkout.com tokens sampled from the 2026 brand kit: surface `#23242B`, raised `#2F2F34`, blue `#2A5DF5`, bright `#165FFF`, lime `#B3FF00` (metrics, success), orange `#FF4F18` (warnings, escalation), purple `#841AFF`. Copy the file verbatim.
- `src/components/ui/controls.tsx` — form primitives, already styled
- `.claude/launch.json` + a `kiosk` script — the demo-day pattern, already proven

That's roughly three hours of styling you don't spend, on a build with eight hours total. It also matters for scoring: 10 of 25 points are demo and pitch, and a Streamlit default theme next to a brand-accurate dark dashboard is a visible gap. Streamlit's advantage is Python-native speed for someone who doesn't have a Next.js codebase with brand tokens already in it. FR does.

Copy, don't fork in place — `~/dev/take-it-or-leave-it` is a separate project from the Thrive Flow builder.

```
take-it-or-leave-it/
  app/
    page.tsx                     # 4-step wizard shell
    book/page.tsx                # Pricing Book admin (M10)
    api/parse-merchant/route.ts  # runtime LLM: text → fields
    api/draft-justification/route.ts
  src/lib/
    brand.ts                     # copied
    types.ts
    engine/
      normalize.ts               # §5.4  ← unit tests live here
      select.ts                  # §5.3
      variance.ts                # §6.1–6.2
      approvals.ts               # §6.3
      index.ts                   # price(intake, book) → Quote
    book.ts                      # load + validate pricing-book.json
  data/
    pricing-book.json            # committed, versioned
    demo-merchants.json          # 3 seeded deals
  sources/
    sources.config.json          # what Glean should fetch
    raw/                         # extracted text, manual fallback
  scripts/
    compile-pricing-book.ts      # M9
  tests/engine.test.ts           # golden cases
  RUNBOOK.md                     # M11
```

`price()` is a pure function of `(intake, book)`. No fetch, no clock, no randomness inside it — pass `today` in. That's what makes the golden tests meaningful.

### 8.2 The Glean compile step (M9)

`scripts/compile-pricing-book.ts`, driven from Claude Code:

1. **Locate** — for each entry in `sources.config.json`, query Glean for the document; capture permalink, title, `doc_updated_at`, extracted text. Prefer the **Glean MCP server** in Claude Code if it's available in the tenant; else the Glean REST search API; else §8.3.
2. **Extract** — Claude reads each document against a strict JSON schema, returning candidate line items each with `source_locator`, `verbatim`, and a self-assessed `confidence`. Instruction: *never infer a rate that isn't written down; emit `confidence: "low"` and a note instead.*
3. **Diff** — compare to the committed book, write `pricing-book.diff.md` in plain English:
   `Network Tokens · per_txn · 0.010 → 0.012 USD · Highspot "Network Tokens" updated 2026-07-30 · was: "…$0.010 per tokenized transaction"`
4. **Approve** — Ad or Ta reads the diff and runs `npm run book:approve -- --by Ad`, which merges, bumps `version`, stamps `reviewed_by` / `reviewed_at`.
5. **Never auto-merge.**

Running this live on Day 3 — Glean pulls, Claude extracts, a diff appears, Ad approves it — *is* the scalability argument. Eight documents today, eighty next quarter, same pipeline.

### 8.3 Fallback if there's no Glean API token

Assume there isn't one until proven otherwise; tenant API access is the most common hackathon blocker. Degraded path, same shape:

1. Ad and Ta use the Glean **UI** to find each source, paste extracted text into `sources/raw/<source_id>.txt` with the permalink and doc date at the top.
2. Steps 2–5 above run unchanged against local text.

Only step 1 loses automation. Glean is still doing the finding — which is the part that actually takes a rep an afternoon — and the story survives intact: *"Glean finds it, Claude structures it, a human approves it. Today step one is a paste; with API access it's a cron."* Have this working by Day 1 so the build never blocks on IT.

### 8.4 Confidentiality (constraint: "prices are very confidential")

| Rule | Implementation |
|---|---|
| No pricing data to third parties at runtime | Engine is offline. The two LLM routes receive merchant descriptions and justification bullets — **never** the book, rates, or bps |
| Book stays internal | Private repo. `data/pricing-book.json` gitignored if the repo is not private |
| No telemetry | No analytics package. Say so |
| Demo-safe | `DEMO_MODE=true` (**default on**) loads `pricing-book.demo.json` — real *structure*, obfuscated *rates*. Real numbers never appear in a recording or a screenshot that leaves the room |
| Rep-facing warning | Deal on a Page footer: "Internal — confidential pricing. Do not forward externally." |

Decide on Day 1 whether judges see real or obfuscated rates, and know which mode the laptop is in before the screen goes up.

### 8.5 FR leaves early — hard requirements

FR is present for slots 1–2. **Day 3 is Ad and Ta with no engineer.** Therefore, before FR leaves:

- `npm run kiosk` — one command, build + serve, no arguments
- Zero required env vars in `DEMO_MODE`; the LLM features degrade to a visible "AI parse unavailable" state rather than throwing
- `data/pricing-book.json` and `demo-merchants.json` committed
- Works with Wi-Fi off — verify by actually turning Wi-Fi off
- `RUNBOOK.md`: how to start, three seeded merchants and the exact numbers each produces, what to say if something breaks, FR's phone number
- **Ad and Ta each run the full demo unaided, in front of FR, before FR leaves.** Not a walkthrough — they drive.

---

## 9. Plan

### Day 1 · Kickoff & framing (4h, all three)

| | |
|---|---|
| 0:00–0:45 | **Read the `.eml` together.** Fill in §6.3 for real. Confirm approver titles |
| 0:45–1:15 | Open `acq framework.csv`. Write down actual column names, keys, bands. Correct §5.2 |
| 1:15–2:00 | Ad + Ta hand-author `pricing-book.json` v0: **3 region×vertical rows, 8 VAS items.** By hand, from the CSV and what they already know. Faster than the compiler and it de-risks everything downstream |
| 1:15–2:00 | *(parallel)* FR scaffolds the app, copies `brand.ts` + controls, writes `types.ts` |
| 2:00–3:00 | Ad + Ta write **5 golden test cases** — real-ish deals, hand-calculated expected TR. These are the acceptance tests *and* the demo script |
| 2:00–4:00 | *(parallel)* FR: engine modules + unit tests against the golden cases |
| 3:00–4:00 | Ad + Ta: locate all 8 Highspot sources in Glean, fill `sources.config.json`, paste raw text (§8.3) |
| 4:00 | **Gate:** engine passes 5/5 golden cases in a terminal. No UI yet. If the engine isn't right, nothing else matters |

Hand-authoring v0 before building the compiler is the sequencing that makes an 8-hour build feasible. The compiler is the *scale* story; the hand-written book is the *working demo*. Build the demo first.

### Day 2 · Deep build (4h — FR's last slot)

| | |
|---|---|
| 0:00–1:30 | FR: Screens 1–3 wired to the engine |
| 1:30–2:30 | FR: Deal on a Page + print CSS + email generator + clipboard |
| 0:00–2:30 | *(parallel)* Ad + Ta: Glean extraction prompt, run it on 2 sources, verify output against the hand-written book — **this is how you know the compiler works** |
| 2:30–3:15 | FR: compile script + diff output + Pricing Book screen |
| 3:15–3:45 | FR: seed 3 demo merchants, `kiosk`, offline test, write `RUNBOOK.md` |
| 3:45–4:00 | **Ad and Ta each drive the full demo. FR watches and fixes nothing** |

If time runs short, cut in this order: plain-English parse (§4.3) → AI justification drafting → Pricing Book screen → compile script. **Never** cut the citation trail or the approval chain; they are the two things that distinguish this from a spreadsheet with nicer fonts.

### Day 3 · Demo (Ad + Ta)

**5-minute run of show:**

| Time | Who | Beat |
|---|---|---|
| 0:00–0:40 | Ta | The wall. "Thirteen tabs, eight PDFs, four systems, and two reps quote the same merchant differently." Name the reframe: the problem is scattered truth, not the spreadsheet |
| 0:40–1:40 | Ta | Live intake. Paste plain English → fields fill → **Target TR in under a second** |
| 1:40–2:30 | Ad | **Click a bp.** Highspot source, exact line, document date. "Every number, back to a document." ← *the moment that wins the AI-quality points* |
| 2:30–3:20 | Ad | Drag the slider down. Variance climbs, revenue-at-risk climbs, **CEO appears.** Deal on a Page, email drafted, copied |
| 3:20–4:20 | Ad | Pricing Book screen → run the Glean compile → diff appears → approve it. "Prices change weekly. This is how they stay current, with a human in the loop." ← *the scale points* |
| 4:20–5:00 | Ta | ROI (§10). Name the cuts (§3.2). "Phase 2 is CAT peer pricing — historic rates from comparable merchants." |

All three names on the title slide with what each owned. Teamwork is scored, and FR's absence is a fact to state plainly, not hide: *"FR built this in two sessions; Ad and Ta are running it without them — that's the handoff test any internal tool has to pass."*

---

## 10. ROI

Fill every `<<…>>` with a real figure from Ad and Ta before Day 3. The brand guidelines are explicit — *back up performance claims* — and judges score whether ROI is clear, not whether it's large. A defensible small number beats an impressive invented one.

**Time recovered**

```
reps globally                 <<N>>
front-book deals / rep / mo   <<D>>
hours per deal today          <<H>>   (Ad + Ta: estimate honestly, incl. chasing sign-off)
hours per deal with the tool  ~0.25
loaded hourly cost            <<C>>

annual hours saved  = N × D × (H − 0.25) × 12
annual value        = annual hours saved × C
```

**Margin leakage avoided** — the larger number, and the one Commercial cares about

```
front-book TPV priced through the tool / yr   <<T>>
bps of unnecessary discount avoided          <<B>>   (from consistency + a visible floor
                                                       + an approver seeing dollars at risk)
annual margin retained = T × B / 10_000
```

At `<<T>> = $2bn` and `<<B>> = 2bps`, that's $400k/year. Two basis points is a modest claim for replacing rep-by-rep improvisation with one cited number.

**Cycle time** — quote turnaround from `<<X>> days` to under an hour. Present the win-rate link as a hypothesis to test, not a claim. Say "we expect", not "this delivers".

---

## 11. Risks

| # | Risk | P | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Approval bands in §6.3 are wrong | **High** | Core claim is false | Day 1, first 45 min. Matrix is JSON config, not code |
| 2 | `acq framework.csv` schema differs from §5.2 | **High** | Rework | Adapter isolates it. Read the CSV before writing `select.ts` |
| 3 | No Glean API token | **High** | Loses the automation demo | §8.3 fallback working by Day 1 |
| 4 | Highspot PDFs extract badly (tables in images) | Med | Manual entry | Hand-written v0 book. `confidence: low` + human review is the designed answer, not a workaround |
| 5 | Real rates leak via recording or screenshot | Med | **Confidentiality** | `DEMO_MODE` default on (§8.4) |
| 6 | FR's absence breaks Day 3 | Med | No demo | §8.5. Ad and Ta rehearse unaided while FR is still there |
| 7 | Scope creep toward 13-tab parity | **High** | Nothing ships | §3.2 cut list is agreed on Day 1 and treated as binding |
| 8 | Per-txn VAS summed as bps | Med | **Numbers silently wrong** | §5.4 + unit tests. This is the most dangerous bug available to this build |
| 9 | Judges probe an edge case live | Med | Credibility | §5.7 refusal path is a strength — demo it deliberately if there's time |

---

## 12. Phase 2

- **CAT peer pricing** (`client-admin.cko-prod.ckotech.co/web/nas/`) — "3 comparable merchants in this vertical and region price at 41–48 bps." Turns guidance into evidence. Needs VPN and a data-access review; stub the panel now.
- **Salesforce** — read opportunity, write the approved rate back. Kills double entry.
- **Approval workflow** — Slack-native approve/reject instead of email, with the audit trail attached.
- **Back-book** — same engine applied to renewals and repricing.
- **Win/loss loop** — feed outcomes back so guidance learns which bands actually close. This is the real long-term prize: pricing guidance that updates itself from results, with a human approving each change.

---

## Appendix A — Golden test cases

Ad and Ta fill this in on Day 1. Hand-calculate the expected column *before* seeing the app's answer; otherwise it's not a test.

| # | Region | Vertical | MCC | ATV | Monthly TPV | Scope % | VAS | Expected target bps | Expected floor | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Europe | Retail — Apparel | | | | 100 | NT, 3DS | | | Vanilla mid-market |
| 2 | North America | Digital Goods | | | | 50 | NT, RTAU, Fraud | | | Partial scope + per-request VAS |
| 3 | APAC | Marketplace | | | | 100 | Integrated Platforms, APMs | | | Platform economics |
| 4 | Europe | Travel | | | | 100 | all 8 | | | High-risk, VAS-heavy |
| 5 | LATAM | Marketplace | | | | 100 | NT | | | **Expected: UNMAPPED** (§5.7) |

Case 5 is deliberate. A tool that can't say "I don't know" isn't finished.

---

## Appendix B — Open questions for Day 1

1. Does the framework key on **region**, **country**, or **legal entity**? (§4.1)
2. Does it price on **risk tier**? (§4.1)
3. Are acquiring rates **TPV-banded**? What are the bands and in which currency? (§5.2)
4. Is there an explicit **floor** column, or is the floor a % of target? (§5.6)
5. Is the **Gateway premium** additive bps, a per-txn fee, or both? (§5.2)
6. Which VAS are quoted **per transaction** vs **bps** vs **monthly flat**? (§5.4)
7. What are the real **default attach rates** for RTAU, 3DS, Fraud? (§5.4)
8. Real approval bands and approver **titles** — from the `.eml`. (§6.3)
9. Is there a **hard floor** no approver can override?
10. **Multi-currency**: does the framework quote per currency, or USD with FX applied? (§5.2)
11. Does Ad or Ta have a **Glean API token**, or is §8.3 the path? (§8.2)
12. Real or obfuscated rates in front of judges? (§8.4)
