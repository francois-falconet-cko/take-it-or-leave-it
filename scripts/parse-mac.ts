/**
 * Parses the Minimum Acceptance Criteria deck into structured sectors.
 *
 * The MAC is not a pricing document, which is exactly why it belongs in the book.
 * It sets the floor *under* the pricing conversation: a high-risk merchant that
 * cannot clear its sector's expected monthly Net Revenue, or whose chargebacks are
 * over 0.9%, is not a discount question. It is a deal that should not reach MAF
 * stage. Today a rep finds that out weeks later.
 *
 * Unlike the pricing decks, this one converted regularly enough to parse: 31
 * numbered sectors, each with a `**MCCs**` block, a `**Minimum Tier / Net Revenue
 * (NR)**` block, and a `### Minimum Acceptance Criteria` bullet list. So it is
 * parsed rather than transcribed, and the parser is strict — if the shape changes
 * it throws instead of silently emitting half a section.
 *
 * The one thing that cannot be parsed is which book vertical each sector belongs
 * to. That mapping lives in scripts/mac-map.ts, by hand, because getting it wrong
 * means a gambling deal gets checked against the furniture criteria.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAC_SECTOR_MAP } from './mac-map.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = resolve(ROOT, 'pricing-files/minimum-acceptance-criteria.md');

export type MacSector = {
  key: string;
  number: number;
  title: string;
  /** Book verticals this sector governs. Empty when it is region- rather than vertical-scoped. */
  verticals: string[];
  /** MCCs named in the sector, parsed out of the MCC block. */
  mccs: string[];
  mcc_note: string | null;
  /** False when the deck hedges the list ("Multiple", "Common MCCs used"). */
  mccs_exclusive: boolean;
  /** Expected monthly Net Revenue floor in USD, when the deck states a figure. */
  min_monthly_net_revenue_usd: number | null;
  net_revenue_verbatim: string | null;
  net_revenue_detail: string | null;
  criteria: string[];
  prohibited: string[];
  notes: string[];
  source_locator: string;
};

export type ParsedMac = {
  source_id: string;
  source_locator: string;
  /** Commercial's own pre-submission gate, from section 1. */
  pre_submission_checklist: string[];
  chargeback_ceiling_pct: number;
  chargeback_verbatim: string;
  sectors: MacSector[];
  report: string[];
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const bullets = (block: string): string[] =>
  block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l !== '' && !l.startsWith('For Internal Use Only'));

/** Strips the "> **For Internal Use Only** " watermark that lands mid-section. */
const dewatermark = (s: string) => s.replace(/^>.*$/gm, '').trim();

type Block = { label: string | null; heading: string | null; lines: string[] };

/**
 * Splits a sector into its `**Label**` and `### Heading` blocks.
 *
 * Done as a line walk rather than a regex because a lazy regex anchored on
 * `^**Label**$` and terminated by `$` in multiline mode matches the empty string
 * at the end of the label's own line — it silently returns nothing for every
 * section and the book ends up with 30 sectors and no criteria in any of them.
 */
function blocks(body: string): Block[] {
  const out: Block[] = [{ label: null, heading: null, lines: [] }];
  for (const line of body.split(/\r?\n/)) {
    const bold = /^\*\*(.+?):?\*\*$/.exec(line.trim());
    const head = /^#{3}\s+(.*)$/.exec(line.trim());
    if (bold) out.push({ label: bold[1].trim(), heading: null, lines: [] });
    else if (head) out.push({ label: null, heading: head[1].trim(), lines: [] });
    else out.at(-1)!.lines.push(line);
  }
  return out;
}

/**
 * Column headers off the MAC slide, and the stray one-word fragments the
 * converter left behind where a text box wrapped. Neither is a criterion.
 */
const NOT_A_CRITERION = new Set(
  [
    'credit & fraud risk profile',
    'appropriate controls & regulatory compliance',
    'sound business practices',
    'business model description',
    'permitted / restricted activity guidance',
    'additional notes',
    'primary risks',
    'reputation',
    'credit risk',
    'mcc risk list',
    'business model &',
  ].map((s) => s.toLowerCase()),
);

/**
 * `$7.5k Expected Monthly Net Revenue (Tier 3)` -> 7500.
 * `Standard MOR: $12.5k per month` -> 12500, taking the lower of the two figures
 * a sector may state, because the lower one is the one a deal has to clear.
 * `Tier 3 and above` -> null. The deck states a tier without a number, and
 * inventing one here would put a fabricated threshold in front of a rep.
 */
function parseNetRevenueUsd(text: string): number | null {
  const hits = [...text.matchAll(/\$\s?(\d+(?:\.\d+)?)\s?k/gi)].map((m) => Number(m[1]) * 1000);
  if (hits.length === 0) return null;
  return Math.min(...hits);
}

/**
 * Wording that marks an MCC list as illustrative rather than definitive.
 *
 * This distinction decides whether an MCC can identify a sector on its own. CBD
 * says "Common MCCs used: 5499, 5912, 5977, 5999" — 5999 is generic misc retail,
 * and treating that as "this merchant sells CBD" would put the wrong criteria in
 * front of a rep with real confidence. Gambling, by contrast, just lists
 * 7995/7800/7801/7802/9406 with no hedge, and those MCCs mean what they say.
 */
const ILLUSTRATIVE = /multiple|common mccs|typical mcc|primary mcc|other mccs are allowed|depends on/i;

function parseMccs(block: string): { mccs: string[]; note: string | null; exclusive: boolean } {
  const lines = bullets(block);
  const mccs = new Set<string>();
  const notes: string[] = [];
  for (const line of lines) {
    const found = [...line.matchAll(/\b(\d{4})\b/g)].map((m) => m[1]);
    found.forEach((m) => mccs.add(m));
    // Anything beyond the digits is a real qualification: "All other MCCs are
    // prohibited", "Cannot be High Risk MCCs", "for long delivery items only".
    const residue = line.replace(/\b\d{4}\b/g, '').replace(/[(),*\/&]/g, ' ').replace(/\s+/g, ' ').trim();
    if (residue.length > 3) notes.push(line);
  }
  const note = notes.length ? notes.join(' · ') : null;
  return { mccs: [...mccs], note, exclusive: !(note != null && ILLUSTRATIVE.test(note)) };
}

const parse = (): ParsedMac => {
  if (!existsSync(DOC)) {
    throw new Error(
      `Missing ${DOC}.\n  The MAC is gitignored with the other confidential sources. Restore pricing-files/ before compiling.`,
    );
  }

  const text = readFileSync(DOC, 'utf8');
  const report: string[] = [];

  // --- Section 1: Commercial's pre-submission gate ---------------------------
  const checklistBlock = /### Commercial pre-submission checklist\n([\s\S]*?)\n### /.exec(text);
  if (!checklistBlock) throw new Error('MAC: could not find the Commercial pre-submission checklist.');
  const checklist = bullets(dewatermark(checklistBlock[1])).filter((l) => l.endsWith('?'));
  if (checklist.length < 5) {
    throw new Error(`MAC: expected at least 5 checklist questions, parsed ${checklist.length}.`);
  }

  const cbLine = checklist.find((l) => /chargeback/i.test(l));
  const cbPct = cbLine ? Number(/([\d.]+)%/.exec(cbLine)?.[1] ?? NaN) : NaN;
  if (!Number.isFinite(cbPct)) {
    throw new Error('MAC: could not parse the chargeback ceiling out of the pre-submission checklist.');
  }

  // --- Numbered sectors -----------------------------------------------------
  // Section 1 is the guidance chapter, not a sector. The Appendix is a blank
  // template and must not become a sector with no criteria.
  const headings = [...text.matchAll(/^## (\d+)\.\s+(.+)$/gm)];
  if (headings.length < 25) throw new Error(`MAC: expected 30+ numbered sections, found ${headings.length}.`);

  const sectors: MacSector[] = [];
  for (let i = 0; i < headings.length; i++) {
    const num = Number(headings[i][1]);
    const title = headings[i][2].trim();
    if (num === 1) continue;

    const start = headings[i].index! + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index! : (text.indexOf('\n## Appendix') + 1 || text.length);
    const body = dewatermark(text.slice(start, end));
    const parts = blocks(body);

    const labelled = (label: string): string | null => {
      const hit = parts.find((p) => p.label === label);
      return hit ? hit.lines.join('\n').trim() : null;
    };

    const mccBlock = labelled('MCCs');
    const nrBlock = labelled('Minimum Tier / Net Revenue (NR)');
    const nrDetail = labelled('NR Detail');

    /**
     * The acceptance criteria live on the second slide of every sector, but not
     * at a predictable place on it: sometimes under the "Minimum Acceptance
     * Criteria" heading, sometimes above it, sometimes split across the slide's
     * three unlabelled columns. So take every bullet from "Source content 2"
     * onward and filter out the column headers. Over-inclusive on purpose —
     * showing a rep one risk note too many is cheaper than dropping a criterion.
     */
    const secondSlide = parts.findIndex((p) => p.heading === 'Source content 2');
    const criteria =
      secondSlide < 0
        ? []
        : parts
            .slice(secondSlide)
            .flatMap((p) => bullets(p.lines.join('\n')))
            .filter((l) => l.length >= 15 && !NOT_A_CRITERION.has(l.toLowerCase().replace(/[:.]$/, '')));

    const prohibitedBlock = bullets(body).filter((l) => /prohibited|not supported|not be considered/i.test(l));

    const { mccs, note, exclusive } = mccBlock
      ? parseMccs(mccBlock)
      : { mccs: [], note: null, exclusive: false };
    const nrText = nrBlock ? bullets(nrBlock).join(' · ') : null;

    const mapped = MAC_SECTOR_MAP[title] ?? MAC_SECTOR_MAP[slug(title)];
    if (mapped === undefined) {
      report.push(`  ! "${title}" has no entry in scripts/mac-map.ts — parsed, but no vertical will trigger it`);
    }

    sectors.push({
      key: slug(title),
      number: num,
      title,
      verticals: mapped ?? [],
      mccs,
      mcc_note: note,
      mccs_exclusive: exclusive,
      min_monthly_net_revenue_usd: nrText ? parseNetRevenueUsd(nrText) : null,
      net_revenue_verbatim: nrText,
      net_revenue_detail: nrDetail ? bullets(nrDetail).join(' · ') || null : null,
      criteria,
      prohibited: prohibitedBlock,
      notes: [],
      source_locator: `MAC section ${num} — ${title}`,
    });
  }

  const withoutCriteria = sectors.filter((s) => s.criteria.length === 0);
  const withoutNr = sectors.filter((s) => s.min_monthly_net_revenue_usd == null);

  report.push(`  ✓ ${sectors.length} sectors · ${checklist.length} pre-submission questions · CB ceiling ${cbPct}%`);
  if (withoutNr.length) {
    report.push(
      `  · ${withoutNr.length} sector(s) state a tier without a dollar figure — no NR floor asserted: ${withoutNr.map((s) => s.title).join(', ')}`,
    );
  }
  if (withoutCriteria.length) {
    report.push(`  · ${withoutCriteria.length} sector(s) had no parseable criteria list: ${withoutCriteria.map((s) => s.title).join(', ')}`);
  }

  return {
    source_id: 'src_mac',
    source_locator: 'Minimum Acceptance Criteria — Guidance for the Commercial Team',
    pre_submission_checklist: checklist,
    chargeback_ceiling_pct: cbPct,
    chargeback_verbatim: cbLine!,
    sectors,
    report,
  };
};

export const mac = parse();
