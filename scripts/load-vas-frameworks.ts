/**
 * Loads the product pricing frameworks and refuses to hand over anything it
 * cannot find in the source document.
 *
 * pricing-files/vas-frameworks.json is a hand transcription of the six Highspot
 * pricing decks that arrived as markdown in pricing-files/*.md. A transcription is
 * the honest way to do this — two of the six decks lost their table structure in
 * conversion, so no parser would get all of them — but a hand transcription is
 * exactly the kind of artefact that quietly acquires a transposed digit.
 *
 * So every number and every verbatim quote is checked back against the text of
 * its own source .md before the compiler is allowed to use it. A typo does not
 * produce a slightly wrong quote three weeks from now; it fails `npm run
 * book:compile` today, with the value and the file named.
 *
 * What is NOT checked: that the transcription put a number in the right cell. A
 * digit swapped between the 2m-5m and 5m-10m columns still appears in the
 * document, so it still passes. Only a human reading the deck catches that, which
 * is what `npm run book:approve` is for.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'pricing-files');
const TRANSCRIPTION = resolve(DIR, 'vas-frameworks.json');

export type MccTier = 'standard' | 'other';

export type RawTierPrices = {
  recommended: (number | null)[];
  floor: (number | null)[];
  ceiling: (number | null)[];
};

export type RawFee = {
  key: string;
  label: string;
  unit: 'bps' | 'per_txn' | 'per_request' | 'monthly_flat' | 'pct_of_value';
  currency: string;
  basis: string;
  driver: 'attached_transactions' | 'volume_share' | 'per_seller_month' | 'unmodelled';
  default_attach_rate: number;
  attach_rate_note: string;
  not_modelled_reason: string | null;
  verbatim: string;
  floor_waived_from_band?: number;
  tiers: { standard: RawTierPrices; other: RawTierPrices } | null;
};

export type RawFramework = {
  key: string;
  label: string;
  source_id: string;
  source_file: string | null;
  source_locator: string;
  doc_updated_at: string | null;
  doc_updated_at_inferred: boolean;
  doc_updated_at_note: string | null;
  doc_extracted_at: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  confidence_note?: string;
  pricing_model: string | null;
  mandatory: boolean;
  free_trials_allowed: boolean;
  approval_below_floor: string[];
  approval_above_ceiling: string[];
  approval_verbatim: string | null;
  scope: string | null;
  needs_extraction: boolean;
  blended_uplift: {
    note: string;
    scheme_fees: { scheme: string; basis: string; amount: number; currency: string }[];
  } | null;
  notes: string[];
  fees: RawFee[];
  reference_methods?: Record<string, string | boolean | null>[];
};

export type VasBand = { index: number; min: number; max: number | null; label: string };

export type LoadedFrameworks = {
  bands: VasBand[];
  mcc_tier_rule: { other: string[]; standard: string[]; verbatim: string; note: string };
  frameworks: RawFramework[];
  /** One line per source document, for the compile log. */
  report: string[];
};

/**
 * Both sides of every comparison go through this. Markdown syntax, slide
 * bullets, line wrapping and sentence punctuation are all artefacts of the PDF
 * conversion rather than anything the pricing team wrote, so none of them should
 * be able to fail a match.
 *
 * The decimal point stays. It is the one piece of punctuation here that carries
 * meaning: strip it and 1.99% and 0.02 stop being findable, which is the whole
 * point of the exercise.
 */
function normalize(text: string): string {
  return text
    .replace(/[*_#|●•>]/g, ' ')
    .replace(/[–—-]/g, ' ')
    .replace(/[,:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The forms a price could plausibly be written in. `0.1` in the transcription is
 * `0.10` in the deck; `1` is `1.00`; the 3DS floor at 20m+ is `0.005`.
 */
function numericForms(n: number): string[] {
  return [String(n), n.toFixed(1), n.toFixed(2), n.toFixed(3)];
}

const load = (): LoadedFrameworks => {
  if (!existsSync(TRANSCRIPTION)) {
    throw new Error(
      `Missing ${TRANSCRIPTION}.\n` +
        `  The product pricing frameworks are gitignored along with the CSV and the .eml.\n` +
        `  Restore pricing-files/ before compiling, or the book cannot carry VAS pricing.`,
    );
  }

  const raw = JSON.parse(readFileSync(TRANSCRIPTION, 'utf8'));
  const bands: VasBand[] = raw.bands;
  const frameworks: RawFramework[] = raw.frameworks;
  const problems: string[] = [];
  const report: string[] = [];

  for (const fw of frameworks) {
    if (fw.source_file == null) {
      if (!fw.needs_extraction) {
        problems.push(`${fw.key}: no source_file but needs_extraction is false. One of the two is wrong.`);
      }
      report.push(`  · ${fw.key.padEnd(22)} no source document — needs_extraction`);
      continue;
    }

    const path = resolve(DIR, fw.source_file);
    if (!existsSync(path)) {
      problems.push(`${fw.key}: source_file ${fw.source_file} does not exist.`);
      continue;
    }
    const doc = normalize(readFileSync(path, 'utf8'));

    const present = (needle: string) => doc.includes(normalize(needle));
    let checked = 0;

    const checkNumber = (value: number | null, where: string) => {
      // 0 is how the transcription carries the IP "Waived" floor. There is no
      // digit to look for, so the note carries the meaning instead.
      if (value == null || value === 0) return;
      checked++;
      if (!numericForms(value).some((f) => doc.includes(f))) {
        problems.push(`${fw.key}: ${where} = ${value} does not appear anywhere in ${fw.source_file}.`);
      }
    };

    for (const fee of fw.fees) {
      if (fee.verbatim) {
        checked++;
        if (!present(fee.verbatim)) {
          problems.push(`${fw.key}/${fee.key}: verbatim not found in ${fw.source_file} — "${fee.verbatim}"`);
        }
      }
      if (fee.tiers == null) {
        if (fee.not_modelled_reason == null) {
          problems.push(`${fw.key}/${fee.key}: no tiers and no not_modelled_reason. Nothing could be quoted.`);
        }
        continue;
      }
      for (const tier of ['standard', 'other'] as MccTier[]) {
        const prices = fee.tiers[tier];
        for (const level of ['recommended', 'floor', 'ceiling'] as const) {
          const row = prices[level];
          if (row.length !== bands.length) {
            problems.push(
              `${fw.key}/${fee.key}/${tier}/${level}: ${row.length} values for ${bands.length} volume bands.`,
            );
            continue;
          }
          row.forEach((v, i) => checkNumber(v, `${fee.key}/${tier}/${level}[${bands[i].label}]`));
        }
        // A floor above the recommended price, or a ceiling below it, is a
        // transposition the number check cannot see.
        prices.recommended.forEach((rec, i) => {
          if (rec == null) return;
          const floor = prices.floor[i];
          const ceiling = prices.ceiling[i];
          if (floor != null && floor > rec) {
            problems.push(`${fw.key}/${fee.key}/${tier}: floor ${floor} above recommended ${rec} at ${bands[i].label}.`);
          }
          if (ceiling != null && ceiling < rec) {
            problems.push(
              `${fw.key}/${fee.key}/${tier}: ceiling ${ceiling} below recommended ${rec} at ${bands[i].label}.`,
            );
          }
        });
      }
    }

    if (fw.approval_verbatim) {
      checked++;
      if (!present(fw.approval_verbatim)) {
        problems.push(`${fw.key}: approval_verbatim not found in ${fw.source_file}.`);
      }
    }

    report.push(
      `  ✓ ${fw.key.padEnd(22)} ${String(fw.fees.length).padStart(2)} fee(s) · ${String(checked).padStart(3)} value(s) checked against ${fw.source_file}`,
    );
  }

  if (problems.length) {
    throw new Error(
      `The VAS framework transcription does not match its source documents:\n\n` +
        problems.map((p) => `  ✗ ${p}`).join('\n') +
        `\n\nFix pricing-files/vas-frameworks.json against the deck. Nothing is compiled until this is clean.\n`,
    );
  }

  return { bands, mcc_tier_rule: raw.mcc_tier_rule, frameworks, report };
};

export const vasFrameworks = load();
