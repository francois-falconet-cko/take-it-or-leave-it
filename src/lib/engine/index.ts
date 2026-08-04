/**
 * price(intake, book, today) -> Quote
 *
 * A pure function. No network, no LLM, no clock — `today` is a parameter so the
 * same inputs always produce the same quote, which is what makes it testable and
 * what makes a number on screen defensible three weeks later.
 *
 * The guidance take rate comes from the framework's `Total take rate` column,
 * carried through verbatim. We decompose it for explanation (Acquirer Pay In,
 * Other, high-risk uplift) but we never rebuild it from the parts — 43 of 855
 * rows have rounding in the Other column, and a tool that silently "corrects"
 * the guidance document is no longer quoting the guidance.
 */

import type {
  Finding,
  Intake,
  PriceLine,
  PricingBook,
  Quote,
  VasCheck,
  VasLine,
} from '../types.ts';
import {
  effectiveMonthlyTpv,
  fxToUsd,
  mmbImpliedFloorBps,
  monthlyTransactions,
  roundBps,
  toBps,
  volumeDisagreement,
} from './normalize.ts';
import { bandForVolume, selectAcquiring } from './select.ts';
import { discountPct as calcDiscountPct, money } from './variance.ts';
import { routeApproval, sortApprovers } from './approvals.ts';

export * from './normalize.ts';
export * from './select.ts';
export * from './variance.ts';
export * from './approvals.ts';

const EMPTY: Omit<Quote, 'status' | 'findings'> = {
  effectiveMonthlyTpv: null,
  effectiveMonthlyTpvSource: null,
  billableMonthlyTpv: null,
  billableMonthlyTpvUsd: null,
  monthlyTxns: null,
  band: null,
  match: null,
  lines: [],
  targetBps: null,
  requestedBps: null,
  discountPct: null,
  annualRevenueAtRisk: null,
  emnrMonthly: null,
  emnrAnnual: null,
  mmbImpliedFloorBps: null,
  mmbBinds: false,
  approval: null,
  vasCheck: null,
  nearest: [],
  searchedFor: null,
};

export interface PriceOptions {
  /** Rate the rep is asking for. Omit to evaluate guidance alone. */
  requestedBps?: number | null;
}

export function price(intake: Intake, book: PricingBook, today: string, opts: PriceOptions = {}): Quote {
  const findings: Finding[] = [];
  const docDate = (id: string) => book.sources.find((s) => s.id === id)?.doc_updated_at ?? null;

  if (!book.reviewed_by) {
    findings.push({
      level: 'warning',
      code: 'BOOK_UNAPPROVED',
      message: 'Unapproved pricing book — not for external quoting.',
      detail: `Version ${book.version} was compiled but never signed off. Run npm run book:approve once the numbers have been checked.`,
    });
  }

  // --- Volume --------------------------------------------------------------
  const vol = effectiveMonthlyTpv(intake);
  if (!vol) {
    return {
      status: 'BLOCKED',
      findings: [
        ...findings,
        {
          level: 'blocking',
          code: 'NO_VOLUME',
          message: 'Enter a monthly, 3-month or annual processing volume.',
        },
      ],
      ...EMPTY,
    };
  }

  const disagreement = volumeDisagreement(intake);
  if (disagreement && disagreement.spread > 0.15) {
    findings.push({
      level: 'warning',
      code: 'VOLUME_DISAGREEMENT',
      message: `Volume figures disagree by ${Math.round(disagreement.spread * 100)}% once annualized.`,
      detail: disagreement.annualized
        .map((a) => `${a.label}: ${intake.currency} ${Math.round(a.value).toLocaleString('en-US')}`)
        .join('  ·  '),
    });
  }

  const scopePct = intake.scopePct > 0 ? intake.scopePct : 100;
  const billableMonthlyTpv = vol.monthly * (scopePct / 100);
  const billableMonthlyTpvUsd = fxToUsd(billableMonthlyTpv, intake.currency, book);
  const monthlyTpvMusd = billableMonthlyTpvUsd / 1_000_000;
  const monthlyTxns = monthlyTransactions(billableMonthlyTpv, intake.atv);
  const annualBillableTpvUsd = billableMonthlyTpvUsd * 12;

  if (!intake.atv || intake.atv <= 0) {
    findings.push({
      level: 'warning',
      code: 'NO_ATV',
      message: 'Average transaction value is missing.',
      detail:
        'Guidance take rate does not need ATV, but per-transaction VAS pricing and the transaction count do. Add it to run the VAS attach check.',
    });
  }

  const band = bandForVolume(book, monthlyTpvMusd);
  const bandOnTotal =
    scopePct < 100 ? bandForVolume(book, fxToUsd(vol.monthly, intake.currency, book) / 1_000_000)?.cat ?? null : null;

  if (bandOnTotal != null && band != null && bandOnTotal !== band.cat) {
    findings.push({
      level: 'info',
      code: 'BAND_ON_SCOPED_VOLUME',
      message: `Banded on Checkout-processed volume (Cat ${band.cat}), not merchant total (Cat ${bandOnTotal}).`,
      detail: `Scope is ${scopePct}% of the merchant's volume. The guidance says the take rate scales with "the merchant's monthly processing volume" without saying whose share — this tool uses the volume Checkout.com would process. Confirm with Strategic Pricing if the merchant's total should set the band.`,
    });
  }

  // --- Guidance row --------------------------------------------------------
  const searchedFor = {
    Region: intake.region,
    Vertical: intake.vertical,
    'Country scope': intake.countryScope ?? 'regional default',
    'Risk level': intake.riskLevel,
    'Monthly volume': `$${monthlyTpvMusd.toFixed(2)}m (Cat ${band?.cat ?? '—'})`,
  };

  const sel = selectAcquiring(book, {
    region: intake.region,
    vertical: intake.vertical,
    countryScope: intake.countryScope,
    riskLevel: intake.riskLevel,
    monthlyTpvMusd,
  });

  if (!sel.match) {
    findings.push(unmappedFinding(sel.reason, intake, monthlyTpvMusd, book));
    return {
      status: 'UNMAPPED',
      findings,
      ...EMPTY,
      effectiveMonthlyTpv: vol.monthly,
      effectiveMonthlyTpvSource: vol.source,
      billableMonthlyTpv,
      billableMonthlyTpvUsd,
      monthlyTxns,
      band: band ? { ...band, catOnTotalVolume: bandOnTotal } : null,
      nearest: sel.nearest,
      searchedFor,
    };
  }

  const row = sel.match;
  if (sel.nearest.length > 0) {
    findings.push({
      level: 'warning',
      code: 'DUPLICATE_ROWS',
      message: `${sel.nearest.length + 1} framework rows match this merchant. Quoted the lowest.`,
      detail: `Quoted ${row.total_bps} bps. Also matched: ${sel.nearest.map((r) => `${r.total_bps} bps (${r.source_locator})`).join(', ')}.`,
    });
  }

  // --- Decompose the guidance rate ----------------------------------------
  const lines: PriceLine[] = [];
  const srcDate = docDate(row.source_id);

  lines.push({
    key: 'acquirer_pay_in',
    label: 'Acquirer Pay In',
    category: 'acquiring',
    bps: row.acquiring_bps,
    asQuoted: `${(row.acquiring_bps / 100).toFixed(3)}%`,
    sourceId: row.source_id,
    sourceLocator: row.source_locator,
    verbatim: row.verbatim,
    confidence: row.confidence,
    docUpdatedAt: srcDate,
  });

  if (row.other_bps != null) {
    const parts: string[] = [];
    if (row.vas_uplift_pct != null) parts.push(`VAS ${row.vas_uplift_pct}%`);
    if (row.fx_uplift_pct != null) parts.push(`FX ${row.fx_uplift_pct}%`);
    lines.push({
      key: 'other',
      label: 'Other (add-on services)',
      category: 'other',
      bps: row.other_bps,
      asQuoted: `${(row.other_bps / 100).toFixed(3)}%${parts.length ? ` — uplift ${parts.join(' + ')} on Acquirer Pay In` : ''}`,
      sourceId: row.source_id,
      sourceLocator: row.source_locator,
      verbatim: row.verbatim,
      confidence: row.confidence,
      docUpdatedAt: srcDate,
    });
  }

  // The framework's stated total is the truth. If the parts do not add up to it,
  // show the gap as its own line rather than quietly reconciling.
  const partsSum = lines.reduce((s, l) => s + l.bps, 0);
  const statedTotal = row.total_bps;
  const roundingGap = roundBps(statedTotal - partsSum);
  if (Math.abs(roundingGap) >= 0.001) {
    lines.push({
      key: 'rounding',
      label: 'Rounding in source document',
      category: 'rounding',
      bps: roundingGap,
      asQuoted: `${roundingGap > 0 ? '+' : ''}${(roundingGap / 100).toFixed(4)}%`,
      sourceId: row.source_id,
      sourceLocator: row.source_locator,
      verbatim: `Stated total ${(statedTotal / 100).toFixed(3)}% vs components ${(partsSum / 100).toFixed(4)}%`,
      confidence: 'medium',
      docUpdatedAt: srcDate,
    });
    if (!row.reconciles) {
      findings.push({
        level: 'info',
        code: 'ROW_ROUNDING',
        message: 'Acquirer Pay In + Other does not exactly equal the stated total in this framework row.',
        detail: `The framework's stated total (${(statedTotal / 100).toFixed(3)}%) is used. Difference of ${(roundingGap / 100).toFixed(4)}pp shown as a rounding line.`,
      });
    }
  }

  // --- High-risk uplift ----------------------------------------------------
  let targetBps = statedTotal;
  if (intake.riskLevel === 'HIGH') {
    if (row.risk_level === 'ALL') {
      findings.push({
        level: 'info',
        code: 'HIGH_RISK_ALREADY_PRICED',
        message: `${row.vertical} is already priced as a high-risk category — no further uplift.`,
        detail: row.high_risk_note ?? undefined,
      });
    } else if (row.high_risk_uplift_pct != null) {
      const upliftBps = roundBps(statedTotal * (row.high_risk_uplift_pct / 100));
      targetBps = roundBps(statedTotal + upliftBps);
      lines.push({
        key: 'high_risk_uplift',
        label: `High-risk uplift (+${row.high_risk_uplift_pct}%)`,
        category: 'uplift',
        bps: upliftBps,
        asQuoted: `+${row.high_risk_uplift_pct}% on the standard take rate`,
        sourceId: 'src_guidance_email',
        sourceLocator: book.approval_matrix.source_locator,
        verbatim: book.approval_matrix.high_risk_note,
        confidence: 'high',
        docUpdatedAt: docDate('src_guidance_email'),
      });
    } else {
      findings.push({
        level: 'warning',
        code: 'HIGH_RISK_UPLIFT_UNKNOWN',
        message: 'This merchant is high risk but the framework does not state an uplift for this vertical.',
        detail: 'No uplift has been applied. Confirm the treatment with Strategic Pricing before quoting.',
      });
    }
  }

  if (row.risk_level_assumed) {
    findings.push({
      level: 'info',
      code: 'RISK_LEVEL_ASSUMED',
      message: 'The framework row does not state a risk level; treated as standard.',
      detail: row.source_locator,
    });
  }

  if (row.note) {
    findings.push({
      level: 'info',
      code: 'FRAMEWORK_NOTE',
      message: `Framework note on this row: "${row.note}"`,
      detail: row.source_locator,
    });
  }

  // --- ATV sanity against the framework's reference basket -----------------
  if (intake.atv && intake.atv > 0 && row.reference_atv && row.reference_atv > 0) {
    const ratio = intake.atv / row.reference_atv;
    if (ratio >= 2 || ratio <= 0.5) {
      findings.push({
        level: 'info',
        code: 'ATV_DIVERGENCE',
        message: `Merchant ATV (${intake.currency} ${intake.atv}) is ${ratio > 1 ? `${ratio.toFixed(1)}×` : `${(1 / ratio).toFixed(1)}× below`} the framework's reference basket for ${row.vertical} (${row.reference_atv}).`,
        detail:
          'The guidance rate itself is unaffected, but per-transaction VAS economics move a lot with basket size. Worth a look at the attach check.',
      });
    }
  }

  // --- Staleness -----------------------------------------------------------
  if (srcDate) {
    const ageDays = Math.floor((Date.parse(today) - Date.parse(srcDate)) / 86_400_000);
    if (ageDays > 90) {
      findings.push({
        level: 'warning',
        code: 'SOURCE_STALE',
        message: `Pricing source is ${ageDays} days old. Run a refresh before quoting.`,
      });
    }
  }

  const mmbFloor = mmbImpliedFloorBps(intake.mmb, billableMonthlyTpv);

  // --- Requested rate, variance, approvals --------------------------------
  const requestedBps = opts.requestedBps ?? null;
  let discount: number | null = null;
  let m: { emnrMonthly: number; emnrAnnual: number; annualRevenueAtRisk: number } | null = null;
  let approval = null;
  let mmbBinds = false;

  if (requestedBps != null) {
    if (requestedBps <= 0) {
      findings.push({
        level: 'blocking',
        code: 'REQUESTED_NOT_POSITIVE',
        message: 'Requested take rate must be greater than zero.',
      });
    } else {
      discount = calcDiscountPct({ targetBps, requestedBps });
      m = money({ billableMonthlyTpv, targetBps, requestedBps });

      if (mmbFloor != null && requestedBps < mmbFloor) {
        mmbBinds = true;
        findings.push({
          level: 'warning',
          code: 'MMB_BINDS',
          message: `The Monthly Minimum Bill is the real price at this volume, not the requested rate.`,
          detail: `MMB of ${intake.currency} ${intake.mmb!.toLocaleString('en-US')} on ${intake.currency} ${Math.round(billableMonthlyTpv).toLocaleString('en-US')} monthly volume implies ${mmbFloor.toFixed(1)} bps, above the requested ${requestedBps} bps.`,
        });
      }

      approval = routeApproval({
        matrix: book.approval_matrix,
        discountPct: discount,
        annualBillableTpvUsd,
        intake,
      });
      approval = { ...approval, approvers: sortApprovers(approval.approvers) };
    }
  }

  // --- VAS attach check ----------------------------------------------------
  const vasCheck = buildVasCheck(intake, book, row.other_bps ?? 0, billableMonthlyTpv);

  return {
    status: findings.some((f) => f.level === 'blocking') ? 'BLOCKED' : 'OK',
    findings,
    effectiveMonthlyTpv: vol.monthly,
    effectiveMonthlyTpvSource: vol.source,
    billableMonthlyTpv,
    billableMonthlyTpvUsd,
    monthlyTxns,
    band: band ? { ...band, catOnTotalVolume: bandOnTotal } : null,
    match: row,
    lines,
    targetBps: roundBps(targetBps),
    requestedBps,
    discountPct: discount,
    annualRevenueAtRisk: m?.annualRevenueAtRisk ?? null,
    emnrMonthly: m?.emnrMonthly ?? null,
    emnrAnnual: m?.emnrAnnual ?? null,
    mmbImpliedFloorBps: mmbFloor,
    mmbBinds,
    approval,
    vasCheck,
    nearest: [],
    searchedFor,
  };
}

/**
 * Does the selected VAS bundle plausibly deliver the uplift the framework assumes?
 *
 * This is the one place product list pricing appears, and it is deliberately
 * advisory. The framework's "Other" line already carries expected VAS and FX
 * revenue, so adding list prices on top of the total would double-count it.
 */
function buildVasCheck(
  intake: Intake,
  book: PricingBook,
  frameworkOtherBps: number,
  billableMonthlyTpv: number,
): VasCheck {
  const lines: VasLine[] = [];
  let sum = 0;
  let anyUnverified = false;
  let anyMissing = false;

  for (const entry of book.vas_catalogue) {
    const sel = intake.vas[entry.key];
    if (!sel?.enabled) continue;

    const attachRate = sel.attachRate ?? entry.default_attach_rate;
    const bps =
      entry.amount == null
        ? null
        : toBps({
            unit: entry.unit,
            amount: entry.amount,
            currency: entry.currency,
            atv: intake.atv,
            attachRate,
            billableMonthlyTpv,
            dealCurrency: intake.currency,
            book,
          });

    if (bps == null) anyMissing = true;
    else sum += bps;
    if (entry.needs_extraction || entry.confidence === 'unverified') anyUnverified = true;

    lines.push({
      key: entry.key,
      label: entry.label,
      unit: entry.unit,
      amount: entry.amount,
      currency: entry.currency,
      attachRate,
      bps: bps == null ? null : roundBps(bps),
      needsExtraction: entry.needs_extraction,
      confidence: entry.confidence,
      sourceId: entry.source_id,
      notes: entry.notes,
    });
  }

  const selectedListPriceBps = lines.length === 0 || anyMissing ? null : roundBps(sum);
  return {
    frameworkOtherBps,
    selectedListPriceBps,
    deltaBps: selectedListPriceBps == null ? null : roundBps(selectedListPriceBps - frameworkOtherBps),
    anyUnverified,
    lines,
  };
}

function unmappedFinding(
  reason: string,
  intake: Intake,
  monthlyTpvMusd: number,
  book: PricingBook,
): Finding {
  switch (reason) {
    case 'no_region':
      return {
        level: 'blocking',
        code: 'UNMAPPED_REGION',
        message: `The Acquirer Guidance does not cover "${intake.region}".`,
        detail: `Covered regions are ${book.dimensions.regions.join(', ')}. Route to your Regional Leader and Strategic Pricing for a bespoke quote.`,
      };
    case 'no_vertical':
      return {
        level: 'blocking',
        code: 'UNMAPPED_VERTICAL',
        message: `No guidance for "${intake.vertical}" in ${intake.region}.`,
        detail: `The framework covers ${book.dimensions.verticals.length} verticals. If this merchant genuinely falls outside them, Strategic Pricing sets the rate.`,
      };
    case 'below_min_band':
      return {
        level: 'blocking',
        code: 'BELOW_GUIDANCE_FLOOR',
        message: `Guidance starts at $1m monthly volume. This deal is $${monthlyTpvMusd.toFixed(2)}m.`,
        detail:
          'Below the framework floor there is no guidance take rate to discount against. Route to your Regional Leader and Strategic Pricing.',
      };
    case 'no_risk_row':
      return {
        level: 'blocking',
        code: 'UNMAPPED_RISK',
        message: `No framework row covers ${intake.riskLevel} risk for this merchant type.`,
        detail: 'Confirm the risk classification, then route to Strategic Pricing.',
      };
    default:
      return {
        level: 'blocking',
        code: 'UNMAPPED_BAND',
        message: `No guidance row matches $${monthlyTpvMusd.toFixed(2)}m monthly volume for this merchant.`,
        detail: 'Route to your Regional Leader and Strategic Pricing.',
      };
  }
}
