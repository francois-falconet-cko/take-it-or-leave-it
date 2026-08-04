/**
 * Volume normalization and fee-unit conversion.
 *
 * Everything a merchant might quote — monthly, quarterly, annual volume; fees
 * per transaction, per request, per month, as a percentage — resolves here into
 * two canonical forms: monthly TPV, and basis points on TPV.
 *
 * The unit conversions matter more than they look. Network Tokens, RTAU, 3DS and
 * Vault are quoted per transaction or per request, not in basis points. Adding a
 * $0.25 RTAU fee to a take rate as if it were "25 bps" overstates it by roughly
 * two orders of magnitude at a $50 basket. The only safe path from a per-unit
 * fee to bps runs through ATV, and for per-request fees, through an attach rate.
 */

import type { Currency, FeeUnit, PricingBook } from '../types.ts';

export function fxToUsd(amount: number, currency: string, book: PricingBook): number {
  const rate = book.fx.rates[currency];
  if (rate == null) throw new Error(`No FX rate for ${currency} in pricing book ${book.version}`);
  return amount * rate;
}

export function fxFromUsd(amountUsd: number, currency: string, book: PricingBook): number {
  const rate = book.fx.rates[currency];
  if (rate == null) throw new Error(`No FX rate for ${currency} in pricing book ${book.version}`);
  return amountUsd / rate;
}

export interface EffectiveVolume {
  monthly: number;
  source: 'monthly' | 'three_month' | 'annual';
}

/**
 * Monthly TPV, preferring the most direct figure the rep supplied.
 * Returns null when there is nothing to work from — the caller blocks.
 */
export function effectiveMonthlyTpv(input: {
  monthlyTpv: number | null;
  threeMonthTpv: number | null;
  annualTpv: number | null;
}): EffectiveVolume | null {
  if (input.monthlyTpv && input.monthlyTpv > 0) return { monthly: input.monthlyTpv, source: 'monthly' };
  if (input.threeMonthTpv && input.threeMonthTpv > 0)
    return { monthly: input.threeMonthTpv / 3, source: 'three_month' };
  if (input.annualTpv && input.annualTpv > 0) return { monthly: input.annualTpv / 12, source: 'annual' };
  return null;
}

/**
 * Do the volume figures the rep gave us agree with each other once annualized?
 * Returns the disagreement as a fraction, or null when there is nothing to
 * compare. Fat-fingered volume is the most common error in the spreadsheet this
 * replaces, and it is silent — the model just produces a confident wrong number.
 */
export function volumeDisagreement(input: {
  monthlyTpv: number | null;
  threeMonthTpv: number | null;
  annualTpv: number | null;
}): { spread: number; annualized: { label: string; value: number }[] } | null {
  const annualized: { label: string; value: number }[] = [];
  if (input.monthlyTpv && input.monthlyTpv > 0)
    annualized.push({ label: 'Monthly TPV × 12', value: input.monthlyTpv * 12 });
  if (input.threeMonthTpv && input.threeMonthTpv > 0)
    annualized.push({ label: '3-month TPV × 4', value: input.threeMonthTpv * 4 });
  if (input.annualTpv && input.annualTpv > 0) annualized.push({ label: 'Annual TPV', value: input.annualTpv });
  if (annualized.length < 2) return null;

  const values = annualized.map((a) => a.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { spread: (max - min) / max, annualized };
}

export interface ToBpsInput {
  unit: FeeUnit;
  amount: number;
  currency: string;
  /** Required for per_txn and per_request. */
  atv: number | null;
  /** Required for per_request. Fraction of transactions the fee applies to. */
  attachRate?: number;
  /** Required for monthly_flat. In the same currency as `amount` after FX. */
  billableMonthlyTpv: number | null;
  /** Currency the merchant deal is denominated in. */
  dealCurrency: Currency;
  book: PricingBook;
}

/**
 * A single fee, expressed in basis points of TPV. Returns null when a required
 * input is missing — we would rather show a gap than a fabricated number.
 */
export function toBps(input: ToBpsInput): number | null {
  const { unit, amount, currency, atv, attachRate, billableMonthlyTpv, dealCurrency, book } = input;

  // Fees are quoted in their own currency; the deal is in the merchant's.
  const amountInDealCurrency =
    currency === dealCurrency ? amount : fxFromUsd(fxToUsd(amount, currency, book), dealCurrency, book);

  switch (unit) {
    case 'bps':
      return amount;

    case 'pct_of_value':
      return amount * 100;

    case 'per_txn':
      if (!atv || atv <= 0) return null;
      return (amountInDealCurrency / atv) * 10_000;

    case 'per_request': {
      if (!atv || atv <= 0) return null;
      const rate = attachRate ?? 1;
      return ((amountInDealCurrency * rate) / atv) * 10_000;
    }

    case 'monthly_flat':
      if (!billableMonthlyTpv || billableMonthlyTpv <= 0) return null;
      return (amountInDealCurrency / billableMonthlyTpv) * 10_000;
  }
}

/** Monthly transaction count implied by volume and basket size. */
export function monthlyTransactions(billableMonthlyTpv: number | null, atv: number | null): number | null {
  if (!billableMonthlyTpv || !atv || atv <= 0) return null;
  return billableMonthlyTpv / atv;
}

/**
 * Monthly Minimum Bill expressed as a take rate. If a requested rate prices
 * below this, the MMB is the real price and the quote contradicts itself.
 */
export function mmbImpliedFloorBps(mmb: number | null, billableMonthlyTpv: number | null): number | null {
  if (!mmb || mmb <= 0 || !billableMonthlyTpv || billableMonthlyTpv <= 0) return null;
  return (mmb / billableMonthlyTpv) * 10_000;
}

export const roundBps = (n: number): number => Math.round(n * 1000) / 1000;
export const roundPct = (n: number): number => Math.round(n * 100) / 100;
export const roundMoney = (n: number): number => Math.round(n * 100) / 100;
