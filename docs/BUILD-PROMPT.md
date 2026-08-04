# Take It or Leave It — Build Prompts for Claude Code

Companion to [PRD.md](PRD.md). Paste these into Claude Code **in order**, one per stage.

**Why staged and not one mega-prompt:** an 8-hour build described in a single prompt drifts — the model front-loads UI and under-builds the engine, and you find out at hour six. Staging puts a verifiable gate after the part that must be right (the engine) and keeps each step small enough to check. Run Stage 0 once, then Stage 1, and don't start Stage 2 until Stage 1's tests pass.

**Before you start:**

```bash
cp ~/Downloads/"acq framework.csv" ~/Downloads/"IMPORTANT_ Acquirer Guidance - How We Price & Approve New Front Book Deals.eml" ~/dev/take-it-or-leave-it/sources/
```

Then read both, and correct §6.3 of the PRD with the **real** approval bands. Every stage below assumes you've done this.

---

## Stage 0 — Scaffold and context

```
Set up a new Next.js project for a Checkout.com internal sales tool called
"Take It or Leave It". Read docs/take-it-or-leave-it/PRD.md first — it is the
spec and it is authoritative. Where this prompt and the PRD disagree, follow
the PRD.

Project root: ~/dev/take-it-or-leave-it (create it; separate from thrive2026).

1. Scaffold: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 +
   zustand + lucide-react. Match the dependency versions in
   ~/dev/thrive2026/package.json.

2. Copy these three files over verbatim — they are the Checkout.com design
   system and I do not want them re-derived:
     ~/dev/thrive2026/src/lib/brand.ts            -> src/lib/brand.ts
     ~/dev/thrive2026/src/components/ui/controls.tsx -> src/components/ui/controls.tsx
     ~/dev/thrive2026/app/globals.css             -> app/globals.css
   Adapt globals.css only as needed to compile.

3. Copy the ~/dev/thrive2026/.claude/launch.json pattern, port 3400. Add npm
   scripts: dev, build, start, kiosk (build && start), typecheck, test.

4. Create the directory layout in PRD §8.1 exactly, with empty placeholder
   files.

5. Write CLAUDE.md at the project root containing:
   - The Take Rate definition from PRD §5.1
   - The compile-time-vs-runtime boundary from PRD §2, stated as a hard rule:
     the pricing engine is a pure function, no network, no LLM, no Date.now()
     inside it — `today` is always passed in
   - The confidentiality rules from PRD §8.4, including: never send pricing
     book contents, rates, or bps to any external API
   - Brand: dark UI only, tokens from src/lib/brand.ts, never raw Tailwind
     colors. Headlines uppercase, no trailing period.

Do not build any UI or engine logic yet. Stop after step 5 and show me the tree.
```

---

## Stage 1 — Engine and tests · **this is the gate**

Nothing else gets built until this passes. If the arithmetic is wrong, a beautiful UI is a liability.

```
Implement the pricing engine per PRD §5 and §6. Pure TypeScript, no UI, no
network. Read PRD §5.2–§5.8 and §6.1–§6.3 in full before writing code.

FILES
  src/lib/types.ts            Intake, PricingBook, PriceLine, Quote, Finding
  src/lib/engine/normalize.ts unit -> bps conversion (PRD §5.4)
  src/lib/engine/select.ts    row selection + specificity scoring (PRD §5.3)
  src/lib/engine/variance.ts  variance, eMNR, revenue at risk (PRD §6.1–6.2)
  src/lib/engine/approvals.ts approval chain from the matrix (PRD §6.3)
  src/lib/engine/index.ts     price(intake, book, today): Quote
  src/lib/book.ts             load + runtime-validate pricing-book.json
  data/pricing-book.json      hand-authored v0 (see below)
  tests/engine.test.ts        golden cases

CRITICAL — do not get these wrong:

1. UNIT NORMALIZATION (PRD §5.4). VAS are NOT all quoted in bps. Implement all
   five units: bps, per_txn, per_request, monthly_flat, pct_of_value.
     per_txn      -> amount / ATV * 10_000
     per_request  -> amount * attachRate / ATV * 10_000
     monthly_flat -> amount / billableTpv * 10_000
     pct_of_value -> amount * 100
   Summing per-transaction fees as if they were bps is the single most
   dangerous bug in this build. Unit-test each conversion independently.

2. attachRate is REQUIRED for per_request. Default from the book, overridable
   per quote. Never assume 1.0 for a per_request item.

3. price() returns PriceLine[], never a bare number. Every line carries
   sourceId, sourceLocator, verbatim, confidence, docUpdatedAt. Provenance is
   part of the calculation, not looked up afterwards.

4. VARIANCE SIGN (PRD §6.1). variance = (target - requested)/target * 100.
   If requested >= target, variance <= 0 and NO approval is required — return
   an empty approver chain, not "Regional Sales Leader". Guard this explicitly
   with a test.

5. TWO-DIMENSIONAL ESCALATION (PRD §6.3). Take the higher of the
   variance band and the revenue-at-risk band. Return the full cumulative
   chain with a binding reason string per approver, e.g.
   { name: "CRO", reason: "8.2% variance vs guidance" }.
   Bands are half-open [min, max) so boundary values have exactly one answer.

6. NO-GUIDANCE PATH (PRD §5.7). Zero matching rows -> return
   Quote.status = 'UNMAPPED' with the search criteria used, the nearest
   adjacent rows clearly flagged as non-guidance, and the unmapped approver
   chain. Never fall back to an adjacent row as if it were guidance. Never
   invent a rate.

7. price() is pure. today: string is a parameter. No Date.now(), no
   Math.random(), no fetch anywhere under src/lib/engine/.

DATA
  Write data/pricing-book.json by hand to the PRD §5.2 schema, covering
  Appendix A cases 1-4 plus all 8 VAS items. Use placeholder rates and set
  confidence: "low" on every one, with a top-level
  "reviewed_by": null. Ad and Ta replace the numbers on Day 1 — the schema
  matters here, the values don't yet.

  Also write data/pricing-book.demo.json: identical structure, obfuscated
  rates, for DEMO_MODE (PRD §8.4).

TESTS
  Implement PRD Appendix A cases 1-5 as tests. Case 5 (LATAM Marketplace) must
  assert status === 'UNMAPPED'. Add unit tests for: each of the five unit
  conversions; requested > target -> empty chain; requested exactly at a band
  boundary; MMB-implied floor conflict; below-floor -> maximal chain; the
  volume disagreement warning (PRD §4.4).

When done, run the tests and show me the output. Do not write any UI.
```

**Gate:** tests green in a terminal, and Ad or Ta has eyeballed the numbers for one case by hand. Then continue.

---

## Stage 2 — Intake and recommendation (Steps 1–2)

```
Build the intake form and the recommendation screen against the engine from
Stage 1. PRD §4 and §5.

SHELL
  Four-step wizard: Intake -> Recommendation -> Accept/Challenge -> Deal on a
  Page. zustand store. Persist to localStorage so a browser refresh mid-demo
  is survivable. Dark UI, tokens from src/lib/brand.ts only.

SCREEN 1 — INTAKE (PRD §4.1)
  All fields in the §4.1 tables. Build the ●-marked engine-critical ones first
  and make them visually primary; the rest are secondary.
  - MCC input resolves the vertical live via book.mcc_map and displays it
    inline so a bad MCC is caught immediately. Vertical stays overridable.
  - scope_pct is a NUMBER input (default 100) with a separate free-text scope
    note. PRD §4.2 — do not make scope text-only.
  - Each VAS toggle expands to show its unit as quoted (e.g. "$0.01 / txn")
    and, for per_request items, an editable attach-rate slider.
  - Volume sanity check per PRD §4.4: non-blocking warning naming both figures.
  - Inline validation: ATV and one volume field are required to proceed.

SCREEN 2 — RECOMMENDATION (PRD §5)
  - Target TR in bps, very large. Floor TR beside it, smaller.
  - Waterfall table rendering PriceLine[] directly: label | as quoted |
    attach rate | bps contribution | source | staleness dot.
  - Every row's source is a clickable link to the Highspot/Confluence URL,
    with source_locator and verbatim shown on hover or expand. This is the
    most important interaction in the product — make it feel deliberate, not
    like a tooltip afterthought.
  - Staleness colours per PRD §5.8. Book-level banner if reviewed_by is null:
    "Unapproved pricing book — not for external quoting."
  - Right rail: billable monthly TPV, monthly transaction count, expected
    eMNR, MMB, MMB-implied floor with a conflict flag if it binds.
  - status === 'UNMAPPED' renders the PRD §5.7 refusal state instead of a
    rate: what was searched, adjacent rows labelled as non-guidance, and the
    route to Deal Desk. Give this real design attention — we demo it on
    purpose.
  - Tooltip on "Take Rate" carrying the PRD §5.1 definition.

Two primary actions: ACCEPT and CHALLENGE.
```

---

## Stage 3 — Challenge, Deal on a Page, email (Steps 3–4)

```
Build the challenge flow and both outputs. PRD §6.4 and §7.

CHALLENGE (PRD §6.4)
  - Requested TR: slider (floor - 20% .. target + 20%) plus a numeric input,
    kept in sync.
  - Recompute live on every change: variance %, expected eMNR monthly and
    annual, annual revenue at risk, approval chain, MMB conflict.
  - Annual revenue at risk is the largest number on the screen. Approvers
    approve dollars, not percentages.
  - The approval chain animates as it changes — dragging the slider down until
    CEO appears is the demo's emotional beat. Colour-shift the chain by
    severity using brand tokens (lime -> orange as escalation rises). Make the
    CEO transition unmistakable.
  - Reason category required (from book.approval_matrix.reason_categories).
    Justification textarea required, min 40 chars.
  - If requested >= target, show "At or above guidance — no sign-off required"
    and hide the approver chain entirely.

DEAL ON A PAGE (PRD §7.1)
  Seven blocks in the order given in §7.1. Must fit 1440x900 without
  scrolling. Include the Phase 2 CAT panel, greyed and labelled "Phase 2 —
  peer pricing from CAT". Footer: "Internal — confidential pricing. Do not
  forward externally."

  Export via window.print() with a real @media print stylesheet: white
  background, black text, no chrome, no nav, page-break-inside: avoid on the
  waterfall. Set document.title to DealOnAPage_<Merchant>_<YYYY-MM-DD> before
  printing. No PDF library.

EMAIL (PRD §7.2)
  Render the §7.2 template exactly, all placeholders filled from the quote.
  - "Copy to clipboard" is the PRIMARY action.
  - mailto: is SECONDARY and guarded: if the encoded body exceeds 1,900
    characters, disable it with a tooltip pointing at Copy. A silently
    truncated approval email is worse than no button.
  - No auto-send. No mail API. The human reads and sends.
  - Editable preview before copying.
```

---

## Stage 4 — Glean compile pipeline

The scalability points live here. Build it even if it only runs against pasted text.

```
Build the pricing book compile pipeline. PRD §8.2, with the §8.3 fallback as
the default assumption — assume there is NO Glean API token until proven
otherwise.

sources/sources.config.json
  One entry per pricing source: id, title, system, url, a Glean search query,
  and which pricing-book section it feeds. Seed it with all 10 sources from
  the brief: MAC, acq framework CSV, Gateway + Acquirer premium, Network
  Tokens, Forward API & Vault, Integrated Platforms, RTAU, Settlement Fees,
  Fraud Detection, Authentication, APMs.

scripts/compile-pricing-book.ts
  Stage A — LOCATE
    If GLEAN_API_TOKEN is set, query the Glean search API per source and
    capture permalink, title, doc_updated_at, extracted text into
    sources/raw/<id>.txt.
    If not set, read sources/raw/<id>.txt directly, parsing the permalink and
    doc date from a header block at the top of the file. Print clearly which
    mode it ran in. Never fail because the token is missing.

  Stage B — EXTRACT
    For each source, one Claude call against a strict JSON schema returning
    candidate line items. Each item MUST carry source_locator, verbatim (the
    quoted source text), and a self-assessed confidence.
    Instruct the model: never infer a rate that is not written down. If a rate
    is unclear or a table did not extract cleanly, emit confidence "low" with
    a note — do not guess. An honest gap is useful; a plausible invention is
    not.

  Stage C — DIFF
    Compare candidates to the committed data/pricing-book.json. Write
    pricing-book.diff.md in plain English, one line per change:
      Network Tokens · per_txn · 0.010 -> 0.012 USD
        Highspot "Network Tokens" (updated 2026-07-30)
        was: "...$0.010 per tokenized transaction"
    Sections: ADDED / CHANGED / REMOVED / LOW CONFIDENCE — NEEDS HUMAN.
    Never write to pricing-book.json in this script.

  Stage D — APPROVE (separate script, scripts/approve-book.ts)
    npm run book:approve -- --by "Ad"
    Merges candidates, bumps version to <date>.<n>, stamps reviewed_by and
    reviewed_at. This is the only code path that may modify
    data/pricing-book.json.

CONFIDENTIALITY: the extraction call sends source document text to Claude,
which is the point. It must never send the existing pricing book, and no
runtime code path may send rates anywhere. Keep the compile script strictly
offline from the app.
```

---

## Stage 5 — Pricing Book screen and demo hardening

```
Final stage. PRD §8.4, §8.5, M10.

/book — PRICING BOOK SCREEN
  Read-only. Book version, reviewed_by / reviewed_at (loud red if null),
  source count, oldest document date. Table of all sources: title, system,
  doc_updated_at, staleness badge, link. Coverage gaps from
  book.coverage_gaps rendered as "known unknowns", framed as deliberate.
  Render pricing-book.diff.md if present. A "Run refresh" button is fine as a
  copyable command — do not shell out from the browser.

DEMO MODE (PRD §8.4)
  DEMO_MODE defaults to TRUE. When true, load pricing-book.demo.json and show
  a small persistent "DEMO DATA" chip. Real rates must never appear in a
  recording by accident.

data/demo-merchants.json
  Three seeded deals matching Appendix A cases 1, 2 and 5. One-click load from
  the intake screen. Case 5 loads the UNMAPPED state — we demo that on
  purpose.

GRACEFUL DEGRADATION (PRD §8.5)
  Zero required env vars. If no Anthropic key is present, the plain-English
  parse and AI justification buttons render disabled with "AI parse
  unavailable — enter fields manually". Never throw, never white-screen.

VERIFY, and show me the output of each:
  1. npm run typecheck
  2. npm run test
  3. npm run kiosk, then load the app with Wi-Fi OFF and complete all four
     steps end to end
  4. Print to PDF and confirm the page is clean

RUNBOOK.md (PRD §8.5) — written for Ad and Ta, who will run Day 3 without me:
  - Exact start command
  - The three demo merchants and the exact numbers each produces, so a wrong
    number is spotted instantly
  - The 5-minute run of show from PRD §9 Day 3
  - What to do if it won't start (kill port 3400, rebuild)
  - What to say if something breaks mid-demo
  - FR's phone number
```

---

## Stage 6 — Optional, only if time remains

Cut from the bottom up. Never cut the citation trail or the approval chain.

```
Add the plain-English intake parser. PRD §4.3.

app/api/parse-merchant/route.ts — POST { text } -> structured intake JSON via
one Claude call with a strict schema.

Rules:
  - Populates intake fields ONLY. It may not produce, adjust, or influence any
    rate, bps figure, or approval routing. Prices come from the book, always.
  - Fields it filled are visually marked as AI-filled and stay fully editable.
  - Nothing submits without the rep confirming.
  - Unparseable input leaves fields untouched and says so.

Then, if time still remains: app/api/draft-justification/route.ts — expands
the rep's bullets into prose for the approval email, using the deal's own
numbers. Same rule: it writes prose, never numbers it wasn't given.
```

---

## One-shot version

If you'd rather hand Claude Code the whole build at once — less control, and the engine tends to get short-changed:

```
Read docs/take-it-or-leave-it/PRD.md in full. It is the authoritative spec.
Build the complete application in ~/dev/take-it-or-leave-it following
docs/take-it-or-leave-it/BUILD-PROMPT.md stages 0 through 5 in order.

Stop after each stage, show me what you built, and wait for my go-ahead.

Absolute rules, in priority order:
  1. The pricing engine is a pure function of (intake, book, today). No
     network, no LLM, no clock inside it.
  2. Implement all five fee units (PRD §5.4). Per-transaction fees are NOT
     bps. Getting this wrong makes every number wrong.
  3. Every rate on screen carries a source, a locator, and a document date.
  4. If guidance does not cover the input, refuse and route (PRD §5.7). Never
     invent a rate.
  5. Variance sign: requested >= target means NO approval needed (PRD §6.1).
  6. No pricing data leaves the machine at runtime (PRD §8.4).
  7. It must run with Wi-Fi off and zero env vars (PRD §8.5).

Stage 1 has a hard gate: its tests must pass before you write any UI.
```

---

## Verification checklist before FR leaves

| ✅ | Check | PRD |
|---|---|---|
| ☐ | `npm run test` — all golden cases pass, Case 5 returns UNMAPPED | A |
| ☐ | `npm run typecheck` clean | |
| ☐ | Per-txn VAS convert correctly at two different ATVs — hand-check one | §5.4 |
| ☐ | Requested TR above target → empty approver chain | §6.1 |
| ☐ | Slider from target to below floor → chain escalates to CEO | §6.3 |
| ☐ | Every waterfall row links to a real source URL | §5.2 |
| ☐ | Stale source shows amber/red | §5.8 |
| ☐ | Print output is clean on one page | §7.1 |
| ☐ | Copy-to-clipboard produces the full email; `mailto:` guard works | §7.2 |
| ☐ | Compile script runs and writes a readable diff | §8.2 |
| ☐ | `DEMO_MODE` on by default, chip visible | §8.4 |
| ☐ | **Wi-Fi off, zero env vars, full flow completes** | §8.5 |
| ☐ | `RUNBOOK.md` written | §8.5 |
| ☐ | **Ad ran the full demo unaided. Ta ran the full demo unaided.** | §8.5 |
| ☐ | Cold start → Deal on a Page timed at under 60s — write the number down | §3.3 |
