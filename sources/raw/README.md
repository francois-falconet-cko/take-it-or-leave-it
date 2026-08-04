# sources/raw — pasted source text

`npm run book:refresh` looks here when there is no Glean API token. One file per
source, named for its `id` in `sources/sources.config.json`.

Assume there is no token. Getting one inside a hackathon window is the single most
likely thing to block the build, and this path makes the pipeline work without it:
Glean still does the finding, which is the part that costs a rep an afternoon.
Only the fetch is a paste.

## Format

Three header lines, a blank line, then the document text.

```
url: https://checkout.highspot.com/items/647dde7dc4f2ebc1f397d615
updated: 2026-07-30
retrieved-via: glean UI

Network Tokens
...paste the pricing section here...
```

- `url` — the Highspot permalink. Ends up as the clickable source on every rate.
- `updated` — the document's own revision date, `YYYY-MM-DD`. This drives the
  staleness badge. If the document does not state one, write `unknown` rather
  than today's date: a made-up freshness date is worse than an admitted gap.
- `retrieved-via` — free text. `glean UI`, `highspot direct`, whoever.

## How to fill these

1. Search Glean for the document (the `glean_query` in `sources.config.json` is a
   starting point).
2. Open it, copy the pricing section — the table, the fee list, the footnotes.
   Footnotes matter: that is usually where the attach rate hides.
3. Paste into `sources/raw/<source_id>.txt` with the header above.
4. `npm run book:refresh` → read `pricing-book.diff.md` → `npm run book:approve -- --by "<you>"`.

Do not edit `data/pricing-book.json` by hand. The diff-then-approve path exists so
that a change to a quotable rate always has a name against it.

## Files needed

Every source in `sources.config.json` with `extractor: "claude"`:

- `src_pricing_model.txt` — Pricing Model for Front Book
- `src_mac.txt` — MAC (merchant acquiring costs)
- `src_gateway_premium.txt` — Gateway + Acquirer premium
- `src_vas_network_tokens.txt`
- `src_vas_rtau.txt`
- `src_vas_forward_vault.txt`
- `src_vas_integrated_platforms.txt`
- `src_vas_settlement.txt`
- `src_vas_fraud.txt`
- `src_vas_authentication.txt`
- `src_vas_apms.txt`

The Acquirer Framework CSV and the guidance email are not in this list — they are
structured already and go through `npm run book:compile` instead.

None of these block a working demo. The guidance take rate comes from the
framework CSV alone; these only fill in the VAS attach check.
