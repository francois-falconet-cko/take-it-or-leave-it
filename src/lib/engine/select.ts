/**
 * Guidance row selection.
 *
 * The Acquirer Framework is keyed on region x vertical x country scope x risk
 * level x monthly volume band. There are no wildcards in the data, so selection
 * is an exact match on the first four and a band containment test on the fifth.
 *
 * The one piece of judgement is country scope. Some regions carry more specific
 * overrides — FRIT and SEU inside EEA, United States inside NORAM, UAE inside
 * MENA. A rep who names a scope should get the override; a rep who does not
 * should get the regional default and must never accidentally be priced off a
 * France/Italy row.
 */

import type { AcquiringRow, PricingBook, RiskLevel } from '../types.ts';

export interface SelectCriteria {
  region: string;
  vertical: string;
  countryScope: string | null;
  riskLevel: RiskLevel;
  /** Monthly TPV in USD millions — the unit the framework's bands use. */
  monthlyTpvMusd: number;
}

export interface SelectResult {
  match: AcquiringRow | null;
  /** Ranked alternatives, shown when there is no match. Never used as guidance. */
  nearest: AcquiringRow[];
  reason: 'match' | 'no_region' | 'no_vertical' | 'below_min_band' | 'no_band' | 'no_risk_row';
}

export function bandContains(row: AcquiringRow, monthlyTpvMusd: number): boolean {
  const { min, max } = row.monthly_tpv_band_musd;
  if (monthlyTpvMusd < min) return false;
  // Half-open [min, max) so a merchant at exactly 5m/mo lands in one band only.
  if (max != null && monthlyTpvMusd >= max) return false;
  return true;
}

/**
 * Rows whose risk level admits this merchant.
 *
 * `ALL` rows cover every risk level — those verticals (Crypto, Gambling) are
 * already priced as high risk, which is why the framework marks them "no
 * additions". `STD` rows cover standard risk, and cover high risk too but with
 * the 15% uplift applied downstream in price().
 */
function riskEligible(row: AcquiringRow, riskLevel: RiskLevel): boolean {
  if (row.risk_level === 'ALL') return true;
  return riskLevel === 'STD' || riskLevel === 'HIGH';
}

export function selectAcquiring(book: PricingBook, c: SelectCriteria): SelectResult {
  const byRegion = book.acquiring.filter((r) => r.region === c.region);
  if (byRegion.length === 0) {
    return { match: null, nearest: [], reason: 'no_region' };
  }

  const byVertical = byRegion.filter((r) => r.vertical === c.vertical);
  if (byVertical.length === 0) {
    return {
      match: null,
      // Same region, any vertical, roughly the right size — for context only.
      nearest: byRegion.filter((r) => bandContains(r, c.monthlyTpvMusd)).slice(0, 6),
      reason: 'no_vertical',
    };
  }

  // Country scope. With a scope named, prefer its rows and fall back to the
  // regional default. Without one, regional default rows only.
  const scoped = c.countryScope ? byVertical.filter((r) => r.country_scope === c.countryScope) : [];
  const regional = byVertical.filter((r) => r.country_scope === null);
  const pool = scoped.length > 0 ? scoped : regional;

  if (pool.length === 0) {
    return { match: null, nearest: byVertical.slice(0, 6), reason: 'no_band' };
  }

  const eligible = pool.filter((r) => riskEligible(r, c.riskLevel));
  if (eligible.length === 0) {
    return { match: null, nearest: pool.slice(0, 6), reason: 'no_risk_row' };
  }

  const inBand = eligible.filter((r) => bandContains(r, c.monthlyTpvMusd));

  if (inBand.length === 0) {
    const floor = Math.min(...eligible.map((r) => r.monthly_tpv_band_musd.min));
    if (c.monthlyTpvMusd < floor) {
      // Guidance starts at $1m/month. Smaller merchants are genuinely outside it.
      return {
        match: null,
        nearest: eligible.filter((r) => r.cat === Math.min(...eligible.map((e) => e.cat))).slice(0, 3),
        reason: 'below_min_band',
      };
    }
    return { match: null, nearest: eligible.slice(0, 6), reason: 'no_band' };
  }

  // More than one row in band means a duplicate in the framework. Take the lower
  // rate and let the caller warn: quoting the cheaper of two ambiguous rows is
  // the recoverable mistake, quoting the dearer one loses the deal.
  const match = [...inBand].sort((a, b) => a.total_bps - b.total_bps)[0];
  return { match, nearest: inBand.filter((r) => r !== match), reason: 'match' };
}

/** Which band a given monthly volume falls in, independent of any row match. */
export function bandForVolume(book: PricingBook, monthlyTpvMusd: number): { cat: number; min: number; max: number | null } | null {
  return (
    book.monthly_tpv_bands_musd.find(
      (b) => monthlyTpvMusd >= b.min && (b.max == null || monthlyTpvMusd < b.max),
    ) ?? null
  );
}

/** MCC to vertical, using the book's hand-mapped table. */
export function verticalForMcc(book: PricingBook, mcc: string) {
  return book.mcc_map.find((m) => m.mcc === mcc.trim()) ?? null;
}
