/**
 * Product pricing frameworks: band, tier, verdict.
 *
 * Six frameworks (Network Tokens, RTAU, Fraud Detection Pro, Authentication,
 * Integrated Platforms, APMs) all share one shape. A price is a function of three
 * things, and getting any of them wrong produces a number that looks fine:
 *
 *   1. Monthly processing volume band — 500k/1m/2m/5m/10m/20m. NOT the acquiring
 *      Cat ladder, and read in the DEAL currency, because every deck prints a
 *      single figure under "Monthly Processing Volume ($/£/€)".
 *   2. MCC tier — Standard or Other. Other is 25-50% more expensive on every
 *      product, and a merchant lands there on chargebacks above 1% or a
 *      Restricted/High CKO risk rating.
 *   3. Recommended / floor / ceiling — three numbers per cell, not one. The floor
 *      and the ceiling each carry an approval requirement.
 *
 * Pure, like the rest of the engine. No network, no clock.
 */

import type {
  AdjustedRate,
  AdjustedRateComponent,
  Intake,
  MccTier,
  PricingBook,
  VasFee,
  VasFramework,
  VasLine,
  VasVerdict,
  VasVolumeBand,
} from '../types.ts';
import { roundBps, toBps } from './normalize.ts';

/**
 * Which MCC table this merchant is priced from.
 *
 * Chargeback ratio wins when we have it, because that is the deck's own first
 * test and it is a fact rather than a classification. Falling back to the risk
 * level is an inference, so it is reported as one.
 */
export function mccTierFor(intake: Intake): { tier: MccTier; reason: string } {
  const cb = intake.chargebackRatioPct;
  if (cb != null && cb > 1) {
    return {
      tier: 'other',
      reason: `Chargeback ratio of ${cb}% is above the 1% line, so every product prices off its Other MCCs table.`,
    };
  }
  if (intake.riskLevel === 'HIGH') {
    return {
      tier: 'other',
      reason:
        'Priced off the Other MCCs table because the merchant is high risk. The decks define Other as a chargeback ratio above 1% OR a Restricted/High CKO risk rating — this is the second test.',
    };
  }
  return {
    tier: 'standard',
    reason:
      cb == null
        ? 'Priced off the Standard MCCs table: standard risk, and no chargeback ratio supplied to test against the 1% line.'
        : `Priced off the Standard MCCs table: standard risk and chargebacks at ${cb}%, inside the 1% line.`,
  };
}

/**
 * VAS volume band for a monthly volume in the deal currency.
 *
 * Returns null below the lowest band. The frameworks start at 500k and there is
 * nothing to quote under that — better an explicit gap than the 500k-1m price
 * applied to a merchant the deck never contemplated.
 */
export function vasBandFor(bands: VasVolumeBand[], monthlyVolumeMillions: number): VasVolumeBand | null {
  return (
    bands.find((b) => monthlyVolumeMillions >= b.min && (b.max == null || monthlyVolumeMillions < b.max)) ?? null
  );
}

export const primaryFee = (fw: VasFramework): VasFee | undefined => fw.fees[0];

function priceAt(fee: VasFee, tier: MccTier, bandIndex: number) {
  if (fee.tiers == null) return { recommended: null, floor: null, ceiling: null };
  const t = fee.tiers[tier];
  return {
    recommended: t.recommended[bandIndex] ?? null,
    floor: t.floor[bandIndex] ?? null,
    ceiling: t.ceiling[bandIndex] ?? null,
  };
}

function verdictFor(
  amount: number | null,
  recommended: number | null,
  floor: number | null,
  ceiling: number | null,
): VasVerdict {
  if (amount == null) return 'no_rate';
  // Floor and ceiling are checked before the recommendation, because they are the
  // ones that route an approval. A price can be below the recommendation and still
  // perfectly fine; below the floor it never is.
  if (floor != null && amount < floor) return 'below_floor';
  if (ceiling != null && amount > ceiling) return 'above_ceiling';
  if (recommended == null) return 'at_recommended';
  if (amount > recommended) return 'above_recommended';
  if (amount < recommended) return 'below_recommended';
  return 'at_recommended';
}

export interface VasContext {
  intake: Intake;
  book: PricingBook;
  /** Billable monthly TPV in the deal currency. */
  billableMonthlyTpv: number;
  band: VasVolumeBand | null;
  tier: MccTier;
}

/**
 * One fee, in basis points of TPV.
 *
 * `toBps` already folds the attach rate into per_request fees. For volume-share
 * fees it cannot — a percentage of value has no transaction to attach to — so the
 * share is applied here instead. Applying it in both places would square it.
 */
function feeBps(fee: VasFee, amount: number | null, attachRate: number, ctx: VasContext): number | null {
  if (amount == null || fee.driver === 'unmodelled') return null;

  const { intake, book, billableMonthlyTpv } = ctx;
  // 'LOCAL' means the deck prints one number for $/£/€: the fee is already in the
  // deal currency and must not be run through an FX rate.
  const currency = fee.currency === 'LOCAL' ? intake.currency : fee.currency;

  if (fee.driver === 'per_seller_month') {
    if (!intake.activeSellers || intake.activeSellers <= 0) return null;
    return toBps({
      unit: 'monthly_flat',
      amount: amount * intake.activeSellers * attachRate,
      currency,
      atv: intake.atv,
      billableMonthlyTpv,
      dealCurrency: intake.currency,
      book,
    });
  }

  const base = toBps({
    unit: fee.unit,
    amount,
    currency,
    atv: intake.atv,
    attachRate,
    billableMonthlyTpv,
    dealCurrency: intake.currency,
    book,
  });
  if (base == null) return null;
  return fee.driver === 'volume_share' ? base * attachRate : base;
}

/**
 * Core acquiring, as the rep prices it: acquirer markup plus gateway fee.
 *
 * The markup is already a percentage of volume, so it converts to bps by
 * multiplication and needs nothing else. The gateway fee is per transaction, so it
 * needs ATV — and without ATV it returns null rather than a plausible guess,
 * because a gateway fee silently treated as bps is off by the basket size.
 */
export function coreAcquiringComponents(
  intake: Intake,
  book: PricingBook,
  billableMonthlyTpv: number,
): AdjustedRateComponent[] {
  const out: AdjustedRateComponent[] = [];

  if (intake.acquirerMarkupPct != null && intake.acquirerMarkupPct !== 0) {
    out.push({
      key: 'acquirer_markup',
      label: 'Acquirer markup',
      asEntered: `${intake.acquirerMarkupPct}%`,
      bps: roundBps(intake.acquirerMarkupPct * 100),
      blockedReason: null,
      group: 'core_acquiring',
    });
  }

  if (intake.gatewayFee != null && intake.gatewayFee !== 0) {
    const bps = toBps({
      unit: 'per_txn',
      amount: intake.gatewayFee,
      currency: intake.gatewayFeeCurrency,
      atv: intake.atv,
      billableMonthlyTpv,
      dealCurrency: intake.currency,
      book,
    });
    out.push({
      key: 'gateway_fee',
      label: 'Gateway fee',
      asEntered: `${intake.gatewayFeeCurrency} ${intake.gatewayFee} / txn`,
      bps: bps == null ? null : roundBps(bps),
      blockedReason: bps == null ? 'Needs average transaction value to convert a per-transaction fee to bps.' : null,
      group: 'core_acquiring',
    });
  }

  return out;
}

/**
 * Assembles the Sales Rep Adjusted Take Rate from core acquiring and the priced
 * VAS lines. A component that could not be converted marks the total `incomplete`
 * rather than dropping out silently — a rep quoting from an understated total is
 * the failure mode worth being noisy about.
 */
export function buildAdjustedRate(
  core: AdjustedRateComponent[],
  vasLines: VasLine[],
  recommendedBps: number | null,
): AdjustedRate | null {
  const vasComponents: AdjustedRateComponent[] = vasLines.map((l) => ({
    key: `${l.frameworkKey}.${l.key}`,
    label: `${l.frameworkLabel} — ${l.label}`,
    asEntered:
      l.amount == null
        ? '—'
        : l.unit === 'pct_of_value'
          ? `${l.amount}%${l.attachRate !== 1 ? ` on ${Math.round(l.attachRate * 100)}% of volume` : ''}`
          : `${l.currency} ${l.amount}${l.unit === 'per_request' && l.attachRate !== 1 ? ` × ${Math.round(l.attachRate * 100)}%` : ''}`,
    bps: l.bps,
    blockedReason: l.bps == null ? (l.notModelledReason ?? 'No framework price to quote.') : null,
    group: 'vas' as const,
  }));

  const components = [...core, ...vasComponents];
  if (components.length === 0) return null;

  const sum = (g: AdjustedRateComponent['group']) =>
    components.filter((c) => c.group === g).reduce((n, c) => n + (c.bps ?? 0), 0);

  const coreAcquiringBps = roundBps(sum('core_acquiring'));
  const vasBps = roundBps(sum('vas'));
  const priced = components.filter((c) => c.bps != null);
  const totalBps = priced.length === 0 ? null : roundBps(coreAcquiringBps + vasBps);

  return {
    components,
    coreAcquiringBps,
    vasBps,
    totalBps,
    deltaVsRecommendedBps: totalBps == null || recommendedBps == null ? null : roundBps(totalBps - recommendedBps),
    incomplete: components.some((c) => c.bps == null),
  };
}

/** Every fee of one selected framework, priced for this merchant. */
export function vasLinesFor(fw: VasFramework, ctx: VasContext): VasLine[] {
  const sel = ctx.intake.vas[fw.key];
  const docDate = ctx.book.sources.find((s) => s.id === fw.source_id)?.doc_updated_at ?? fw.doc_updated_at;

  return fw.fees.map((fee, i) => {
    // The primary fee's overrides live at the top of the selection; later fees
    // carry theirs in `fees`, keyed by fee.
    const override = i === 0 ? { attachRate: sel?.attachRate, quotedAmount: sel?.quotedAmount } : sel?.fees?.[fee.key];
    const attachRate = override?.attachRate ?? fee.default_attach_rate;

    const { recommended, floor, ceiling } = ctx.band
      ? priceAt(fee, ctx.tier, ctx.band.index)
      : { recommended: null, floor: null, ceiling: null };

    const quotedAmount = override?.quotedAmount;
    const quoted = quotedAmount != null;
    const amount = quoted ? quotedAmount : recommended;

    const verdict = verdictFor(amount, recommended, floor, ceiling);
    const approvers =
      verdict === 'below_floor'
        ? fw.approval_below_floor
        : verdict === 'above_ceiling'
          ? fw.approval_above_ceiling
          : [];

    const floorWaived = fee.floor_waived_from_band != null && ctx.band != null && ctx.band.index >= fee.floor_waived_from_band;

    return {
      key: fee.key,
      frameworkKey: fw.key,
      label: fee.label,
      frameworkLabel: fw.label,
      unit: fee.unit,
      basis: fee.basis,
      amount,
      quoted,
      recommended,
      floor: floorWaived ? null : floor,
      ceiling,
      floorWaived,
      currency: fee.currency === 'LOCAL' ? ctx.intake.currency : fee.currency,
      attachRate,
      attachRateNote: fee.attach_rate_note,
      bps: (() => {
        const b = feeBps(fee, amount, attachRate, ctx);
        return b == null ? null : roundBps(b);
      })(),
      notModelledReason: fee.not_modelled_reason,
      verdict,
      approvers,
      needsExtraction: fw.needs_extraction,
      confidence: fw.confidence,
      sourceId: fw.source_id,
      sourceLocator: fw.source_locator,
      docUpdatedAt: docDate,
      notes: fw.notes[0] ?? '',
    };
  });
}
