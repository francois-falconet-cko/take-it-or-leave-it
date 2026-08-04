/**
 * Glean -> Claude -> diff. The pipeline that keeps the pricing book current.
 *
 * Run: npm run book:refresh          (add --write to stage candidates)
 *
 * Three stages, and the split matters more than any one of them:
 *
 *   LOCATE   Glean finds each pricing document and reports where it is and when
 *            it last changed. This is the part that costs a rep an afternoon.
 *   EXTRACT  Claude reads the document against a strict schema and returns
 *            candidate rates, each with the verbatim line it came from and a
 *            self-assessed confidence. It is told never to infer a rate that is
 *            not written down.
 *   DIFF     Compare candidates to the committed book and write a plain-English
 *            changelog. Nothing is merged here. Ever.
 *
 * Approval is a separate, human-run script (scripts/approve-book.ts). That
 * separation is the whole governance argument: prices change weekly, a machine
 * proposes, a person decides.
 *
 * Works without a Glean API token. Set one and stage LOCATE automates; without
 * one it reads text a human pasted into sources/raw/<id>.txt, and every later
 * stage is identical. Do not let the absence of a token block the build.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = resolve(ROOT, 'data/pricing-book.json');
const RAW = resolve(ROOT, 'sources/raw');
const CANDIDATES = resolve(ROOT, 'data/candidates.json');
const DIFF = resolve(ROOT, 'pricing-book.diff.md');

const GLEAN_TOKEN = process.env.GLEAN_API_TOKEN;
const GLEAN_HOST = process.env.GLEAN_HOST; // e.g. checkout-be.glean.com
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-5';

type SourceConfig = {
  id: string;
  title: string;
  system: string;
  url: string;
  glean_query: string;
  feeds: string;
  extractor: 'csv' | 'eml' | 'claude';
  local_path?: string;
};

type Candidate = {
  source_id: string;
  vas_key: string | null;
  label: string;
  unit: 'bps' | 'per_txn' | 'per_request' | 'monthly_flat' | 'pct_of_value';
  amount: number | null;
  currency: string;
  default_attach_rate: number | null;
  source_locator: string;
  verbatim: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
};

const config = JSON.parse(readFileSync(resolve(ROOT, 'sources/sources.config.json'), 'utf8'));
const sources: SourceConfig[] = config.sources;
const book = JSON.parse(readFileSync(BOOK, 'utf8'));

if (!existsSync(RAW)) mkdirSync(RAW, { recursive: true });

// ---------------------------------------------------------------------------
// Stage A — LOCATE
// ---------------------------------------------------------------------------

type Located = { source: SourceConfig; text: string; permalink: string; docDate: string | null; via: string };

async function gleanSearch(query: string): Promise<{ text: string; permalink: string; docDate: string | null } | null> {
  if (!GLEAN_TOKEN || !GLEAN_HOST) return null;
  const res = await fetch(`https://${GLEAN_HOST}/rest/api/v1/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${GLEAN_TOKEN}` },
    body: JSON.stringify({ query, pageSize: 3, requestOptions: { facetFilters: [] } }),
  });
  if (!res.ok) {
    console.warn(`  ! Glean returned ${res.status} for "${query}"`);
    return null;
  }
  const json = await res.json();
  const hit = json.results?.[0];
  if (!hit) return null;
  const snippets: string = (hit.snippets ?? []).map((s: { text?: string }) => s.text ?? '').join('\n');
  return {
    text: [hit.title, snippets, hit.document?.content?.fullTextList?.join('\n') ?? ''].filter(Boolean).join('\n\n'),
    permalink: hit.document?.url ?? '',
    docDate: hit.document?.metadata?.updateTime?.slice(0, 10) ?? null,
  };
}

/** sources/raw/<id>.txt, with a small header block a human fills in. */
function readRaw(source: SourceConfig): Located | null {
  const path = resolve(RAW, `${source.id}.txt`);
  if (!existsSync(path)) return null;
  const body = readFileSync(path, 'utf8');
  const permalink = /^url:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? source.url;
  const docDate = /^updated:\s*(\d{4}-\d{2}-\d{2})/im.exec(body)?.[1] ?? null;
  return { source, text: body, permalink, docDate, via: 'manual paste' };
}

async function locate(): Promise<Located[]> {
  const out: Located[] = [];
  const mode = GLEAN_TOKEN && GLEAN_HOST ? 'Glean API' : 'manual paste (sources/raw/*.txt)';
  console.log(`\nSTAGE A — LOCATE   mode: ${mode}\n`);

  for (const source of sources) {
    if (source.extractor !== 'claude') {
      console.log(`  · ${source.id.padEnd(28)} skipped — handled by compile-acq-framework.ts`);
      continue;
    }

    if (GLEAN_TOKEN && GLEAN_HOST) {
      const hit = await gleanSearch(source.glean_query);
      if (hit?.text) {
        writeFileSync(
          resolve(RAW, `${source.id}.txt`),
          `url: ${hit.permalink}\nupdated: ${hit.docDate ?? 'unknown'}\nretrieved-via: glean\n\n${hit.text}\n`,
          'utf8',
        );
        out.push({ source, text: hit.text, permalink: hit.permalink, docDate: hit.docDate, via: 'glean' });
        console.log(`  ✓ ${source.id.padEnd(28)} glean · ${hit.text.length} chars · doc ${hit.docDate ?? 'undated'}`);
        continue;
      }
      console.log(`  ! ${source.id.padEnd(28)} glean found nothing — falling back to raw`);
    }

    const raw = readRaw(source);
    if (raw) {
      out.push(raw);
      console.log(`  ✓ ${source.id.padEnd(28)} raw file · ${raw.text.length} chars · doc ${raw.docDate ?? 'undated'}`);
    } else {
      console.log(`  ✗ ${source.id.padEnd(28)} NOT AVAILABLE — paste text into sources/raw/${source.id}.txt`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage B — EXTRACT
// ---------------------------------------------------------------------------

const EXTRACT_TOOL = {
  name: 'pricing_lines',
  description: 'Pricing line items found verbatim in the document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Product or fee name as the document writes it.' },
            unit: { type: 'string', enum: ['bps', 'per_txn', 'per_request', 'monthly_flat', 'pct_of_value'] },
            amount: { type: 'number', description: 'The numeric price. Omit if the document does not state one.' },
            currency: { type: 'string', description: 'ISO code. USD if unspecified.' },
            default_attach_rate: {
              type: 'number',
              description:
                'For per_request units only: the fraction of transactions the fee applies to, if the document says. Omit if it does not.',
            },
            source_locator: { type: 'string', description: 'Where in the document, e.g. "Pricing table, row 3".' },
            verbatim: { type: 'string', description: 'The exact sentence or cell the number came from.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            notes: { type: 'string' },
          },
          required: ['label', 'unit', 'source_locator', 'verbatim', 'confidence'],
        },
      },
      document_date: { type: 'string', description: 'Revision date stated in the document, YYYY-MM-DD. Omit if absent.' },
      extraction_problems: {
        type: 'array',
        items: { type: 'string' },
        description: 'Anything that did not extract cleanly — an image-only table, an ambiguous unit, a missing currency.',
      },
    },
    required: ['lines'],
  },
};

const EXTRACT_SYSTEM = [
  'You read Checkout.com product pricing documents and return the price lines they contain.',
  '',
  'Non-negotiable rules:',
  '- Never infer, estimate, or calculate a rate that is not written in the document. If a price is unclear, missing, or lives in an image you cannot read, emit the line with no amount, confidence "low", and say why in notes and extraction_problems.',
  '- A wrong number that looks right is far more damaging here than an admitted gap. Someone quotes a merchant from this.',
  '- verbatim must be text actually present in the document, copied exactly. Do not paraphrase it.',
  '- Get the unit right. "$0.01 per tokenized transaction" is per_txn, not bps. "5 bps" is bps. "$250 per month" is monthly_flat. A fee that only fires on some transactions (account updater retries, 3DS challenges) is per_request.',
  '- Only set default_attach_rate if the document states an attach or hit rate. Do not guess one.',
  '',
  'Call pricing_lines exactly once.',
].join('\n');

async function extract(located: Located[]): Promise<Candidate[]> {
  console.log(`\nSTAGE B — EXTRACT   model: ${MODEL}\n`);
  if (!ANTHROPIC_KEY) {
    console.log('  ANTHROPIC_API_KEY not set — skipping extraction.');
    console.log('  Stage A output is in sources/raw/. Set the key and re-run, or hand-edit the book.');
    return [];
  }

  const out: Candidate[] = [];
  for (const loc of located) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: EXTRACT_SYSTEM,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'pricing_lines' },
        messages: [
          {
            role: 'user',
            content: `Document: ${loc.source.title}\nSystem: ${loc.source.system}\nURL: ${loc.permalink}\n\n---\n\n${loc.text.slice(0, 60_000)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.log(`  ✗ ${loc.source.id.padEnd(28)} Claude returned ${res.status}`);
      continue;
    }

    const json = await res.json();
    const block = (json.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
    if (!block) {
      console.log(`  ✗ ${loc.source.id.padEnd(28)} no structured output`);
      continue;
    }

    const vasKey = loc.source.feeds.startsWith('vas:') ? loc.source.feeds.slice(4) : null;
    const lines = (block.input.lines ?? []) as Partial<Candidate>[];
    for (const l of lines) {
      out.push({
        source_id: loc.source.id,
        vas_key: vasKey,
        label: l.label ?? 'unnamed',
        unit: (l.unit ?? 'bps') as Candidate['unit'],
        amount: l.amount ?? null,
        currency: l.currency ?? 'USD',
        default_attach_rate: l.default_attach_rate ?? null,
        source_locator: l.source_locator ?? '',
        verbatim: l.verbatim ?? '',
        confidence: (l.confidence ?? 'low') as Candidate['confidence'],
        notes: l.notes ?? '',
      });
    }

    const problems: string[] = block.input.extraction_problems ?? [];
    console.log(
      `  ✓ ${loc.source.id.padEnd(28)} ${lines.length} line(s)${problems.length ? ` · ${problems.length} problem(s)` : ''}`,
    );
    for (const p of problems) console.log(`      ! ${p}`);
  }

  writeFileSync(CANDIDATES, JSON.stringify({ generated_by: 'compile-pricing-book.ts', candidates: out }, null, 2) + '\n');
  return out;
}

// ---------------------------------------------------------------------------
// Stage C — DIFF. Writes a changelog. Never writes the book.
// ---------------------------------------------------------------------------

function diff(candidates: Candidate[]): string {
  const lines: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const needsHuman: string[] = [];

  const byKey = new Map(book.vas_catalogue.map((v: { key: string }) => [v.key, v]));

  for (const c of candidates) {
    const src = book.sources.find((s: { id: string }) => s.id === c.source_id);
    const provenance = `${src?.system ?? '?'} "${src?.title ?? c.source_id}" · ${c.source_locator}`;
    const quote = c.verbatim ? `\n    was: "${c.verbatim}"` : '';

    if (c.confidence === 'low' || c.amount == null) {
      needsHuman.push(
        `- **${c.label}** — ${c.amount == null ? 'no amount extracted' : `${c.confidence} confidence`}\n    ${provenance}\n    ${c.notes}${quote}`,
      );
      continue;
    }

    const existing = c.vas_key ? (byKey.get(c.vas_key) as { amount: number | null; unit: string } | undefined) : undefined;

    if (!existing) {
      added.push(`- **${c.label}** · ${c.unit} · ${c.amount} ${c.currency}\n    ${provenance}${quote}`);
    } else if (existing.amount !== c.amount || existing.unit !== c.unit) {
      changed.push(
        `- **${c.label}** · ${existing.unit} ${existing.amount ?? '—'} → ${c.unit} ${c.amount} ${c.currency}\n    ${provenance}${quote}`,
      );
    } else {
      unchanged.push(`- ${c.label} · ${c.unit} ${c.amount} ${c.currency} — no change`);
    }
  }

  lines.push(`# Pricing book diff`, ``, `Against committed book **${book.version}**.`, ``);
  lines.push(
    `Nothing in this file has been merged. Read it, then run \`npm run book:approve -- --by "<name>"\` if you agree with it.`,
    ``,
  );

  const section = (title: string, items: string[]) => {
    lines.push(`## ${title} (${items.length})`, ``);
    lines.push(items.length ? items.join('\n') : '_none_', ``);
  };

  section('Changed', changed);
  section('Added', added);
  section('Low confidence — needs a human', needsHuman);
  section('Unchanged', unchanged);

  if (candidates.length === 0) {
    lines.push(
      `## No candidates`,
      ``,
      `Stage B produced nothing. Either ANTHROPIC_API_KEY is unset, or no source text was available.`,
      `Check sources/raw/ — every source with \`extractor: "claude"\` needs a file there when there is no Glean token.`,
      ``,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

const located = await locate();
const candidates = await extract(located);
const report = diff(candidates);
writeFileSync(DIFF, report + '\n', 'utf8');

console.log(`\nSTAGE C — DIFF\n`);
console.log(`  Wrote pricing-book.diff.md — ${candidates.length} candidate line(s) from ${located.length} document(s).`);
console.log(`\n  The book was NOT modified. Read the diff, then:`);
console.log(`    npm run book:approve -- --by "Ad"\n`);
