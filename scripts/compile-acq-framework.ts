/**
 * Compiles the Acquirer Framework CSV into data/pricing-book.json.
 *
 * This is stage A+B+C of the pipeline in PRD 8.2, specialised for the one source
 * that arrives as structured data rather than a PDF. The Highspot VAS one-pagers
 * go through the Claude extraction path instead (scripts/compile-pricing-book.ts).
 *
 * Run: npm run book:compile
 *
 * Three things this script deliberately does NOT do:
 *   - It does not recompute the guidance take rate. The CSV's `Total take rate`
 *     column is authoritative; we carry it through verbatim and flag rows where
 *     our own arithmetic disagrees (42 of 855 do, by rounding). A tool that
 *     silently "corrects" the guidance document is not quoting the guidance.
 *   - It does not invent VAS list prices. Rates we have not extracted are
 *     emitted with amount: null and needs_extraction: true.
 *   - It does not stamp reviewed_by. Only scripts/approve-book.ts does that.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = resolve(ROOT, 'sources/acq framework.csv');
const OUT = resolve(ROOT, 'data/pricing-book.json');

/** The CSV is French-locale Excel: `;` delimited, `,` decimal, space thousands. */
function euroNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw
    .replace(/ /g, '')
    .replace(/ /g, '')
    .replace(/ /g, '')
    .replace(/%/g, '')
    .replace(',', '.')
    .trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Percent string ("0,750%") to basis points. 0.750% -> 75 bps. */
function pctToBps(raw: string | undefined): number | null {
  const n = euroNum(raw);
  return n == null ? null : Math.round(n * 100 * 1000) / 1000;
}

function splitCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(';'));
}

/**
 * `Risk Level` arrives as ALL / All / STD, and blank on 28 rows. ALL means the
 * row covers every risk level (it is a high-risk vertical priced as such);
 * STD means standard risk only. Blank is treated as STD with a flag.
 */
function normRisk(raw: string): { value: 'ALL' | 'STD'; assumed: boolean } {
  const v = raw.trim().toUpperCase();
  if (v === 'ALL') return { value: 'ALL', assumed: false };
  if (v === 'STD') return { value: 'STD', assumed: false };
  return { value: 'STD', assumed: true };
}

/**
 * `Request for Changes Or Agreement` holds two kinds of content: genuine
 * commercial notes ("0.2% for acquiring TR") and spreadsheet debris where a
 * Net Revenue figure got percent-formatted ("11437500%"). Keep the former.
 */
function cleanNote(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  if (/^[\d\s.,]+%?$/.test(s)) return null;
  return s;
}

const rows = splitCsv(readFileSync(CSV, 'utf8'));
const header = rows[0].map((h) => h.trim());
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`CSV column not found: "${name}". Header is: ${header.join(' | ')}`);
  return i;
};

const C = {
  region: col('Region'),
  vertical: col('Vertical'),
  cat: col('Cat'),
  min: col('Min (Million)'),
  max: col('Max (Million)'),
  countries: col('Specific Countries (if any)'),
  risk: col('Risk Level'),
  atv: col('Average ATV'),
  acq: col('Average Take Rate Acquiring Pay IN'),
  other: col('Other take Rate'),
  vas: col('VAS fees + Other'),
  fx: col('% Fx'),
  total: col('Total take rate'),
  netRev: col('Net Revenue'),
  note: col('Request for Changes Or Agreement'),
  highRisk: col('High risk ADD'),
  highFraud: col('High Fraud'),
};

type AcqRow = {
  id: string;
  region: string;
  vertical: string;
  country_scope: string | null;
  risk_level: 'ALL' | 'STD';
  risk_level_assumed: boolean;
  cat: number;
  monthly_tpv_band_musd: { min: number; max: number | null };
  acquiring_bps: number;
  other_bps: number | null;
  vas_uplift_pct: number | null;
  fx_uplift_pct: number | null;
  /** Authoritative. Straight from the CSV's Total take rate column. */
  total_bps: number;
  reference_atv: number | null;
  high_risk_uplift_pct: number | null;
  high_risk_note: string | null;
  note: string | null;
  reconciles: boolean;
  source_id: string;
  source_locator: string;
  verbatim: string;
  confidence: 'high' | 'medium' | 'low';
};

const acquiring: AcqRow[] = [];
const skipped: string[] = [];
let nonReconciling = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const line = i + 1;
  const region = (r[C.region] ?? '').trim();
  const vertical = (r[C.vertical] ?? '').trim();
  const acquiring_bps = pctToBps(r[C.acq]);
  const total_bps = pctToBps(r[C.total]);
  const min = euroNum(r[C.min]);

  if (!region || !vertical || total_bps == null || acquiring_bps == null || min == null) {
    skipped.push(`line ${line}: ${r.slice(0, 5).join(';')} — missing region/vertical/rate/min`);
    continue;
  }

  const max = euroNum(r[C.max]);
  const risk = normRisk(r[C.risk] ?? '');
  const other_bps = pctToBps(r[C.other]);
  const vas_uplift_pct = euroNum(r[C.vas]);
  const fx_uplift_pct = euroNum(r[C.fx]);
  const countryRaw = (r[C.countries] ?? '').trim();
  const highRiskRaw = (r[C.highRisk] ?? '').trim();

  // Does acq + other equal the stated total? Rounding in the Other column makes
  // 42 rows disagree by <0.005pp. We keep the stated total and flag the row.
  const reconciles = other_bps == null ? false : Math.abs(acquiring_bps + other_bps - total_bps) <= 0.15;
  if (!reconciles) nonReconciling++;

  // "15%" -> uplift applies. "High risk category no additions" -> already priced
  // for high risk, no further uplift. Blank -> unknown, no uplift, flagged.
  const highRiskPct = /^\s*(\d+(?:[.,]\d+)?)\s*%\s*$/.test(highRiskRaw) ? euroNum(highRiskRaw) : null;

  // Cat is blank on 5 rows (EEA Insurance FRIT) but Min/Max are present, so the
  // band is still unambiguous — derive the index from the band floor.
  const catRaw = euroNum(r[C.cat]);
  const BAND_FLOORS = [1, 2.5, 5, 10, 25, 50, 100, 250, 500];
  const cat = catRaw ?? BAND_FLOORS.indexOf(min) + 1;

  acquiring.push({
    id: `acq_${region}_${vertical}_${countryRaw || 'ALL'}_${risk.value}_c${cat}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_'),
    region,
    vertical,
    country_scope: countryRaw || null,
    risk_level: risk.value,
    risk_level_assumed: risk.assumed,
    cat,
    monthly_tpv_band_musd: { min, max },
    acquiring_bps,
    other_bps,
    vas_uplift_pct,
    fx_uplift_pct,
    total_bps,
    reference_atv: euroNum(r[C.atv]),
    high_risk_uplift_pct: highRiskPct,
    high_risk_note: highRiskRaw || null,
    note: cleanNote(r[C.note] ?? ''),
    reconciles,
    source_id: 'src_acq_framework',
    source_locator: `acq framework.csv line ${line}`,
    verbatim: [
      region,
      vertical,
      countryRaw || 'all countries',
      risk.value,
      `${min}–${max ?? '∞'}m/mo`,
      `acq ${r[C.acq]?.trim()}`,
      `other ${r[C.other]?.trim()}`,
      `total ${r[C.total]?.trim()}`,
    ].join(' | '),
    confidence: reconciles && !risk.assumed ? 'high' : 'medium',
  });
}

/** Region -> the country scopes that exist as more specific overrides. */
const countryScopes: Record<string, string[]> = {};
for (const a of acquiring) {
  if (!a.country_scope) continue;
  countryScopes[a.region] ??= [];
  if (!countryScopes[a.region].includes(a.country_scope)) countryScopes[a.region].push(a.country_scope);
}

const regions = [...new Set(acquiring.map((a) => a.region))].sort();
const verticals = [...new Set(acquiring.map((a) => a.vertical))].sort();

/** Region x vertical pairs with no row at all — the honest "we don't cover this". */
const covered = new Set(acquiring.map((a) => `${a.region}|${a.vertical}`));
const coverage_gaps: { region: string; vertical: string; reason: string }[] = [];
for (const region of regions) {
  for (const vertical of verticals) {
    if (!covered.has(`${region}|${vertical}`)) {
      coverage_gaps.push({ region, vertical, reason: 'No row in the Acquirer Framework for this region and vertical' });
    }
  }
}

/**
 * MCC -> vertical. Hand-mapped against the framework's 15 verticals, covering the
 * MCCs a front-book rep actually types. Deliberately partial: an unmapped MCC
 * asks the rep to pick a vertical rather than guessing one for them.
 */
const mcc_map: { mcc: string; label: string; vertical: string; risk_default: 'STD' | 'HIGH' }[] = [
  { mcc: '4111', label: 'Local/suburban commuter transport', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '4112', label: 'Passenger railways', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '4121', label: 'Taxicabs and limousines', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '4131', label: 'Bus lines', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '4511', label: 'Airlines, air carriers', vertical: 'Travel & Ticketing', risk_default: 'STD' },
  { mcc: '4722', label: 'Travel agencies and tour operators', vertical: 'Travel & Ticketing', risk_default: 'STD' },
  { mcc: '4784', label: 'Tolls and bridge fees', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '4812', label: 'Telecom equipment', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '4814', label: 'Telecom services', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '4816', label: 'Computer network / information services', vertical: 'SaaS', risk_default: 'STD' },
  { mcc: '4899', label: 'Cable, satellite, pay television', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '5411', label: 'Grocery stores, supermarkets', vertical: 'Food and Groceries', risk_default: 'STD' },
  { mcc: '5462', label: 'Bakeries', vertical: 'Food and Groceries', risk_default: 'STD' },
  { mcc: '5499', label: 'Misc food stores / convenience', vertical: 'Food and Groceries', risk_default: 'STD' },
  { mcc: '5541', label: 'Service stations', vertical: 'Mobility', risk_default: 'STD' },
  { mcc: '5611', label: "Men's clothing", vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5621', label: "Women's ready-to-wear", vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5651', label: 'Family clothing stores', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5661', label: 'Shoe stores', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5691', label: "Men's and women's clothing", vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5732', label: 'Electronics stores', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5734', label: 'Computer software stores', vertical: 'SaaS', risk_default: 'STD' },
  { mcc: '5812', label: 'Eating places, restaurants', vertical: 'Food and Groceries', risk_default: 'STD' },
  { mcc: '5814', label: 'Fast food restaurants', vertical: 'Food and Groceries', risk_default: 'STD' },
  { mcc: '5816', label: 'Digital goods — games', vertical: 'Gaming', risk_default: 'STD' },
  { mcc: '5817', label: 'Digital goods — applications', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '5818', label: 'Digital goods — large merchant', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '5912', label: 'Drug stores and pharmacies', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5942', label: 'Book stores', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5964', label: 'Direct marketing — catalog merchant', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '5999', label: 'Misc retail', vertical: 'Retail', risk_default: 'STD' },
  { mcc: '6012', label: 'Financial institutions — merchandise', vertical: 'Financial Services / Fintech', risk_default: 'STD' },
  { mcc: '6051', label: 'Quasi cash / crypto / FX', vertical: 'Crypto', risk_default: 'HIGH' },
  { mcc: '6211', label: 'Security brokers and dealers', vertical: 'Brokers/Dealers', risk_default: 'STD' },
  { mcc: '6300', label: 'Insurance sales and underwriting', vertical: 'Insurance', risk_default: 'STD' },
  { mcc: '6540', label: 'Non-financial institutions — stored value', vertical: 'Financial Services Misc.', risk_default: 'STD' },
  { mcc: '7011', label: 'Lodging, hotels, resorts', vertical: 'Travel & Ticketing', risk_default: 'STD' },
  { mcc: '7273', label: 'Dating services', vertical: 'Digital', risk_default: 'STD' },
  { mcc: '7299', label: 'Misc personal services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '7311', label: 'Advertising services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '7372', label: 'Computer programming / SaaS', vertical: 'SaaS', risk_default: 'STD' },
  { mcc: '7392', label: 'Management and consulting services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '7399', label: 'Business services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '7801', label: 'Internet gambling', vertical: 'Gambling', risk_default: 'HIGH' },
  { mcc: '7802', label: 'Horse/dog racing', vertical: 'Gambling', risk_default: 'HIGH' },
  { mcc: '7995', label: 'Betting, lottery, casino gaming', vertical: 'Gambling', risk_default: 'HIGH' },
  { mcc: '7996', label: 'Amusement parks, carnivals', vertical: 'Travel & Ticketing', risk_default: 'STD' },
  { mcc: '7999', label: 'Recreation services', vertical: 'Travel & Ticketing', risk_default: 'STD' },
  { mcc: '8299', label: 'Schools and educational services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '8999', label: 'Professional services', vertical: 'Professional Services', risk_default: 'STD' },
  { mcc: '4829', label: 'Money transfer', vertical: 'Money Remittance', risk_default: 'HIGH' },
  { mcc: '6537', label: 'Money transfer — member financial institution', vertical: 'Money Remittance', risk_default: 'HIGH' },
];

/**
 * VAS catalogue. Structure is real, list prices are NOT — every entry is
 * needs_extraction until someone runs the Glean pipeline against the Highspot
 * one-pagers. The placeholder amounts exist so the attach-check panel can be
 * exercised; the UI marks every one of them as unverified.
 *
 * Note this catalogue does NOT feed the guidance take rate. Per the Acquirer
 * Guidance email, "we're moving away from per-product fees toward one overall
 * customer take rate" — the framework's Total take rate already carries the
 * VAS uplift. These entries drive the reconciliation panel only.
 */
type VasEntry = {
  key: string;
  label: string;
  unit: 'bps' | 'per_txn' | 'per_request' | 'monthly_flat' | 'pct_of_value';
  amount: number | null;
  currency: string;
  default_attach_rate: number;
  attach_rate_note: string;
  source_id: string;
  needs_extraction: boolean;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  notes: string;
};

const vas_catalogue: VasEntry[] = [
  {
    key: 'network_tokens',
    label: 'Network Tokens',
    unit: 'per_txn',
    amount: 0.01,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'Applies to every tokenised transaction.',
    source_id: 'src_vas_network_tokens',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount. Extract from Highspot before quoting.',
  },
  {
    key: 'rtau',
    label: 'RTAU',
    unit: 'per_request',
    amount: 0.25,
    currency: 'USD',
    default_attach_rate: 0.05,
    attach_rate_note: 'Only fires on transactions that fail and are retried. 5% is a starting assumption — set it per merchant.',
    source_id: 'src_vas_rtau',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount and attach rate. Both must be confirmed.',
  },
  {
    key: 'forward_vault',
    label: 'Forward API & Vault',
    unit: 'per_request',
    amount: 0.02,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'One forward request per transaction on a vaulted flow.',
    source_id: 'src_vas_forward_vault',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount.',
  },
  {
    key: 'integrated_platforms',
    label: 'Integrated Platforms',
    unit: 'bps',
    amount: 5,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'Applies across platform volume.',
    source_id: 'src_vas_integrated_platforms',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount.',
  },
  {
    key: 'settlement',
    label: 'Settlement Fees',
    unit: 'monthly_flat',
    amount: 250,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'Per settlement cycle; modelled monthly.',
    source_id: 'src_vas_settlement',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount. Real pricing is per payout and depends on cycle and currency.',
  },
  {
    key: 'fraud_detection',
    label: 'Fraud Detection',
    unit: 'per_txn',
    amount: 0.02,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'Screened on every transaction.',
    source_id: 'src_vas_fraud',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount.',
  },
  {
    key: 'authentication',
    label: 'Authentication (3DS)',
    unit: 'per_request',
    amount: 0.04,
    currency: 'USD',
    default_attach_rate: 0.35,
    attach_rate_note: 'Only transactions routed to 3DS. Varies hugely by region and SCA exemption strategy.',
    source_id: 'src_vas_authentication',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount and attach rate.',
  },
  {
    key: 'apms',
    label: 'APMs',
    unit: 'bps',
    amount: 10,
    currency: 'USD',
    default_attach_rate: 1.0,
    attach_rate_note: 'Applies to the APM share of volume — set attach rate to that share.',
    source_id: 'src_vas_apms',
    needs_extraction: true,
    confidence: 'unverified',
    notes: 'PLACEHOLDER amount. APM cost is scheme-specific and largely pass-through.',
  },
];

/**
 * Approval matrix, transcribed from the Acquirer Guidance email of 27 Jul 2026
 * (Paul Goodwin / Strategic Pricing). Bands are half-open [min, max).
 */
const approval_matrix = {
  source_id: 'src_guidance_email',
  source_locator: 'Approval Processes section',
  basis: 'discount % vs guidance total take rate',
  discount_bands: {
    non_gold: [
      { min_pct: 0, max_pct: 25, approvers: ['Regional Leader'], managed_by: null, note: 'Up to 25% discount' },
      { min_pct: 25, max_pct: 50, approvers: ['Regional Leader', 'CRO'], managed_by: 'Strategic Pricing', note: '25%–50% discount' },
      { min_pct: 50, max_pct: null, approvers: ['CEO'], managed_by: 'Strategic Pricing', note: 'Over 50% discount' },
    ],
    gold: [
      { min_pct: 0, max_pct: 10, approvers: ['Team Leader', 'Strategic Pricing'], managed_by: null, note: 'In line, or up to 10% discount' },
      { min_pct: 10, max_pct: 25, approvers: ['Regional Leader', 'Strategic Pricing'], managed_by: null, note: '10%–25% discount' },
      { min_pct: 25, max_pct: 50, approvers: ['Regional Leader', 'CRO'], managed_by: 'Strategic Pricing', note: '25%–50% discount + any cash incentives' },
      { min_pct: 50, max_pct: null, approvers: ['CEO'], managed_by: 'Strategic Pricing', note: 'Over 50% discount + cash incentives above 500k' },
    ],
  },
  gold_triggers: {
    manual_gold_flag: true,
    annual_tpv_usd_gte: 1_000_000_000,
    assumption: 'The email says "any deal above $1B" without naming the measure. Read here as annual TPV. VERIFY with Strategic Pricing.',
  },
  /** Above this discount, Strategic Pricing owns the approval email, not the rep. */
  sp_routing_threshold_pct: 25,
  sp_routing_note: 'Any variance over 25% needs strategic oversight — contact Strategic Pricing and they will manage the approval email to CRO/CEO.',
  qtc_gate: {
    applies_to: ['Gold', 'Tier 1'],
    signatories: ['Antoine', 'Guillaume'],
    text: 'Strategic Pricing cannot sign off items in QTC for Gold and Tier 1 deals without written approval from Antoine or Guillaume. Written sign-off must be in place before anything is actioned in QTC — no exceptions.',
  },
  sp_exceptions: [
    'Adding new entities to an existing approved merchant (no pricing changes)',
    'Minor pricing adjustments of 5% or less to previously approved pricing that was approved by CRO',
  ],
  vas_free_trial_bands: [
    { max_months: 3, approvers: ['Regional Revenue Leader'], note: 'First 3 months, including any extension within that window' },
    { min_months: 4, approvers: ['CRO'], note: '4 months and beyond' },
  ],
  free_processing_excludes: [
    'interchange & scheme fees',
    'FX',
    'APM cost',
    'VAS fees',
    'blended pricing',
    'pass-through costs',
  ],
  high_risk_uplift_pct: 15,
  high_risk_note: 'High-risk merchants incur an additional 15% on standard take-rate fees. Verticals already priced as high risk (Crypto, Gambling) take no further uplift.',
  reprice_out_of_scope: 'Repricing deals follow the existing process — all Tier 1 to the Strategic Pricing team. This tool covers front book only.',
  not_covered_by_guidance: [
    'Acceleration',
    'Stablecoins',
    'Balances held on platform',
    'FX from funds pooling',
  ],
  contact: 'strategic.pricing@checkout.com',
};

const sourcesConfig = JSON.parse(readFileSync(resolve(ROOT, 'sources/sources.config.json'), 'utf8'));
const COMPILED_AT = process.env.BOOK_COMPILED_AT ?? new Date().toISOString();
const DAY = COMPILED_AT.slice(0, 10);
/** Date the Acquirer Guidance was communicated to Commercial. */
const GUIDANCE_EFFECTIVE_FROM = '2026-07-27';

const book = {
  version: `${DAY}.1`,
  generated_at: COMPILED_AT,
  generated_by: 'compile-acq-framework.ts',
  reviewed_by: null as string | null,
  reviewed_at: null as string | null,

  guidance: {
    name: 'Acquirer Guidance',
    effective_from: GUIDANCE_EFFECTIVE_FROM,
    take_rate_definition:
      'Total take rate = Acquirer Pay In % (core fee) + Other (add-on services). It scales with the merchant\'s MONTHLY processing volume. Interchange and scheme fees are pass-through and excluded.',
    volume_basis: 'monthly',
    volume_basis_evidence:
      'Acquirer Guidance email, 27 Jul 2026: "the total take rate, which scales with the merchant\'s monthly processing volume".',
    band_currency: 'USD',
    scope: 'Front book only. Repricing follows the existing Strategic Pricing process.',
  },

  fx: {
    base: 'USD',
    as_of: '2026-08-01',
    rates: { USD: 1, EUR: 1.09, GBP: 1.27 },
    note: 'Static table. Used only to place a merchant into a USD volume band and to convert per-transaction fees. Replace with a real feed before production use.',
  },

  sources: sourcesConfig.sources.map((s: Record<string, unknown>) => {
    const haveLocally = s.id === 'src_acq_framework' || s.id === 'src_guidance_email';
    // The guidance email is dated. The CSV is not, so we date it to the guidance
    // rollout and mark that as inferred rather than leave staleness unmeasurable.
    const docDate = haveLocally ? GUIDANCE_EFFECTIVE_FROM : null;
    return {
      id: s.id,
      title: s.title,
      system: s.system,
      url: s.url,
      doc_updated_at: docDate,
      doc_updated_at_inferred: s.id === 'src_acq_framework',
      doc_updated_at_note:
        s.id === 'src_acq_framework'
          ? 'The framework CSV carries no revision date. Dated to the Acquirer Guidance rollout of 2026-07-27. Ask Strategic Pricing for the real revision date.'
          : null,
      retrieved_at: haveLocally ? COMPILED_AT : null,
      retrieved_via: haveLocally ? 'local file' : 'pending',
      feeds: s.feeds,
    };
  }),

  dimensions: { regions, verticals, country_scopes: countryScopes },
  monthly_tpv_bands_musd: [
    { cat: 1, min: 1, max: 2.5 },
    { cat: 2, min: 2.5, max: 5 },
    { cat: 3, min: 5, max: 10 },
    { cat: 4, min: 10, max: 25 },
    { cat: 5, min: 25, max: 50 },
    { cat: 6, min: 50, max: 100 },
    { cat: 7, min: 100, max: 250 },
    { cat: 8, min: 250, max: 500 },
    { cat: 9, min: 500, max: null },
  ],

  mcc_map,
  acquiring,
  vas_catalogue,
  approval_matrix,
  coverage_gaps,

  quality: {
    rows_in: rows.length - 1,
    rows_compiled: acquiring.length,
    rows_skipped: skipped.length,
    rows_not_reconciling: nonReconciling,
    rows_missing_reference_atv: acquiring.filter((a) => a.reference_atv == null).length,
    rows_with_assumed_risk_level: acquiring.filter((a) => a.risk_level_assumed).length,
    vas_pending_extraction: vas_catalogue.filter((v) => v.needs_extraction).length,
    notes: [
      'Total take rate is carried through verbatim from the CSV and is authoritative.',
      `${nonReconciling} rows have Acquiring + Other != Total (rounding in the Other column). Flagged per row as reconciles: false.`,
      'VAS list prices are placeholders pending Glean extraction and do not affect the guidance take rate.',
    ],
  },

  skipped_rows: skipped,
};

writeFileSync(OUT, JSON.stringify(book, null, 2) + '\n', 'utf8');

/**
 * Demo book. Real structure, real shape of the curve, deliberately wrong rates.
 *
 * DEMO_MODE loads this one and is on by default, so a live walkthrough or a
 * screen recording cannot leak the real front-book rate card. The obfuscation is
 * a fixed multiplier plus a per-row jitter derived from the row id, so it is
 * deterministic (no Math.random — the book must diff cleanly) while breaking any
 * attempt to read the true numbers back out of it.
 */
const DEMO_SCALE = 0.82;

function jitter(id: string): number {
  // Cheap stable hash -> +/-6%.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 1 + ((Math.abs(h) % 120) - 60) / 1000;
}

const obfBps = (bps: number, id: string) => Math.round(bps * DEMO_SCALE * jitter(id) * 100) / 100;

const demoBook = {
  ...book,
  version: `${book.version}-demo`,
  generated_by: `${book.generated_by} (DEMO — rates obfuscated)`,
  demo: {
    is_demo: true,
    warning: 'Rates in this book are deliberately wrong. Never quote from DEMO_MODE.',
    method: `Every rate scaled by ${DEMO_SCALE} plus a deterministic per-row jitter of up to +/-6%.`,
  },
  acquiring: acquiring.map((a) => {
    const total = obfBps(a.total_bps, a.id);
    const acq = obfBps(a.acquiring_bps, a.id + 'a');
    return {
      ...a,
      acquiring_bps: acq,
      other_bps: a.other_bps == null ? null : Math.round((total - acq) * 100) / 100,
      total_bps: total,
      verbatim: `[DEMO DATA — obfuscated] ${a.region} | ${a.vertical} | ${a.country_scope ?? 'all countries'} | ${a.risk_level} | ${a.monthly_tpv_band_musd.min}–${a.monthly_tpv_band_musd.max ?? '∞'}m/mo`,
    };
  }),
  vas_catalogue: vas_catalogue.map((v) => ({
    ...v,
    amount: v.amount == null ? null : Math.round(v.amount * DEMO_SCALE * jitter(v.key) * 10_000) / 10_000,
    notes: `[DEMO DATA — obfuscated] ${v.notes}`,
  })),
};

writeFileSync(resolve(ROOT, 'data/pricing-book.demo.json'), JSON.stringify(demoBook, null, 2) + '\n', 'utf8');

console.log(`Compiled ${acquiring.length}/${rows.length - 1} rows -> data/pricing-book.json`);
console.log(`  version                ${book.version}`);
console.log(`  regions                ${regions.join(', ')}`);
console.log(`  verticals              ${verticals.length}`);
console.log(`  country scopes         ${JSON.stringify(countryScopes)}`);
console.log(`  coverage gaps          ${coverage_gaps.length} region x vertical pairs`);
console.log(`  non-reconciling rows   ${nonReconciling}`);
console.log(`  skipped rows           ${skipped.length}`);
console.log(`  VAS pending extraction ${book.quality.vas_pending_extraction}`);
console.log(`\n  reviewed_by is null — run \`npm run book:approve -- --by "<name>"\` after checking the numbers.`);
if (skipped.length) console.log('\nSkipped:\n' + skipped.map((s) => '  ' + s).join('\n'));
