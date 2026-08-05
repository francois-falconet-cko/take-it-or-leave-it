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
  AdjustedRate,
  Finding,
  Intake,
  MacCheck,
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
  volumeDisagreement,
} from './normalize.ts';
import { bandForVolume, selectAcquiring } from './select.ts';
import { discountPct as calcDiscountPct, money } from './variance.ts';
import { routeApproval, sortApprovers } from './approvals.ts';
import { buildAdjustedRate, coreAcquiringComponents, mccTierFor, primaryFee, vasBandFor, vasLinesFor } from './vas.ts';
import { checkMac } from './mac.ts';

export * from './normalize.ts';
export * from './select.ts';
export * from './variance.ts';
export * from './approvals.ts';
export * from './vas.ts';
export * from './mac.ts';

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
  adjusted: null,
  requestedBps: null,
  discountPct: null,
  annualRevenueAtRisk: null,
  emnrMonthly: null,
  emnrAnnual: null,
  mmbImpliedFloorBps: null,
  mmbBinds: false,
  approval: null,
  vasCheck: null,
  macCheck: null,
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
      // The rate card cannot price this merchant, but the MAC still governs it.
      // A LATAM marketplace has the same criteria to clear as a covered one, and
      // that is worth knowing before the deal goes to Strategic Pricing.
      macCheck: buildMacCheck(intake, book, billableMonthlyTpvUsd, null, findings),
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

  // --- Product pricing frameworks ------------------------------------------
  const vasCheck = buildVasCheck(intake, book, row.other_bps ?? 0, billableMonthlyTpv, findings);

  // --- Sales Rep Adjusted Take Rate ----------------------------------------
  // Bottom-up: core acquiring as the rep prices it, plus the VAS actually on the
  // deal at their framework prices. Runs alongside the guidance recommendation and
  // never feeds it — approvals still measure the requested rate against guidance.
  const adjusted = buildAdjustedRate(
    coreAcquiringComponents(intake, book, billableMonthlyTpv),
    vasCheck.lines,
    roundBps(targetBps),
  );

  // --- Minimum Acceptance Criteria -----------------------------------------
  // Evaluated at the rate actually on the table: the requested one if the rep has
  // named one, otherwise guidance. A deal that clears the eNR floor at guidance
  // and misses it at the requested rate is precisely the case worth surfacing.
  const macCheck = buildMacCheck(intake, book, billableMonthlyTpvUsd, requestedBps ?? targetBps, findings);

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
    adjusted,
    requestedBps,
    discountPct: discount,
    annualRevenueAtRisk: m?.annualRevenueAtRisk ?? null,
    emnrMonthly: m?.emnrMonthly ?? null,
    emnrAnnual: m?.emnrAnnual ?? null,
    mmbImpliedFloorBps: mmbFloor,
    mmbBinds,
    approval,
    vasCheck,
    macCheck,
    nearest: [],
    searchedFor,
  };
}

/**
 * Prices the selected products off their own frameworks, and checks the bundle
 * against the uplift the guidance assumes.
 *
 * Two jobs that used to be one. The attach check is unchanged in spirit — the
 * framework's "Other" line already carries expected VAS and FX revenue, so adding
 * product prices to the total take rate would double-count it, and this stays
 * advisory. What is new is that the product prices are now real: banded on monthly
 * volume, tiered on Standard vs Other MCCs, and carrying the floor and ceiling that
 * decide whether someone has to sign for them.
 */
function buildVasCheck(
  intake: Intake,
  book: PricingBook,
  frameworkOtherBps: number,
  billableMonthlyTpv: number,
  findings: Finding[],
): VasCheck {
  const { tier, reason: tierReason } = mccTierFor(intake);
  // Bands are read in the deal currency: every deck prints one figure under
  // "Monthly Processing Volume ($/£/€)" rather than a dollar figure to convert to.
  const band = vasBandFor(book.vas_bands, billableMonthlyTpv / 1_000_000);

  const lines: VasLine[] = [];
  let sum = 0;
  let anyUnverified = false;
  let anyMissing = false;

  const selected = book.vas_catalogue.filter((fw) => intake.vas[fw.key]?.enabled);

  for (const fw of selected) {
    const fwLines = vasLinesFor(fw, { intake, book, billableMonthlyTpv, band, tier });
    for (const line of fwLines) {
      // A fee we deliberately do not model is not a missing rate — it has a rate,
      // it just has no driver in this intake. Only an absent rate breaks the total.
      if (line.bps == null && line.notModelledReason == null) anyMissing = true;
      else if (line.bps != null) sum += line.bps;
      lines.push(line);
    }
    if (fw.needs_extraction || fw.confidence === 'unverified') anyUnverified = true;

    if (!fw.free_trials_allowed && (intake.vasFreeTrialMonths ?? 0) > 0) {
      findings.push({
        level: 'warning',
        code: 'VAS_FREE_TRIAL_NOT_ALLOWED',
        message: `${fw.label} does not permit free trials.`,
        detail: `The ${fw.label} framework states that free trials are not allowed, but this deal carries ${intake.vasFreeTrialMonths} month(s) of VAS free trial. The Acquirer Guidance free-trial bands do not override a product framework — check with Strategic Pricing.`,
      });
    }

    if (fw.scope && !fw.scope.split('/').some((r) => r.trim().toUpperCase() === intake.region.toUpperCase())) {
      findings.push({
        level: 'warning',
        code: 'VAS_OUT_OF_SCOPE_REGION',
        message: `The ${fw.label} framework covers ${fw.scope} — this deal is ${intake.region}.`,
        detail: 'There is no published framework price for this region. Route the product pricing to Strategic Pricing.',
      });
    }
  }

  for (const line of lines) {
    if (line.verdict === 'below_floor') {
      findings.push({
        level: 'warning',
        code: 'VAS_BELOW_FLOOR',
        message: `${line.frameworkLabel} — ${line.label} at ${line.currency} ${line.amount} is below the framework floor of ${line.currency} ${line.floor}.`,
        detail: line.approvers.length
          ? `Needs ${line.approvers.join(' then ')}. ${line.sourceLocator}.`
          : `${line.sourceLocator}. The framework states no approver for pricing below the floor — confirm with Strategic Pricing.`,
      });
    }
    if (line.verdict === 'above_ceiling') {
      findings.push({
        level: 'warning',
        code: 'VAS_ABOVE_CEILING',
        message: `${line.frameworkLabel} — ${line.label} at ${line.currency} ${line.amount} is above the framework ceiling of ${line.currency} ${line.ceiling}.`,
        detail: line.approvers.length
          ? `Needs ${line.approvers.join(' then ')}. ${line.sourceLocator}.`
          : `${line.sourceLocator}.`,
      });
    }
  }

  // Defensive rather than reachable today: the product frameworks floor at 500k in
  // the deal currency and acquiring guidance floors at $1m, which is at least 787k
  // in any currency the book carries — so anything that gets this far has already
  // cleared 500k. Kept because the two floors are set in different documents by
  // different teams, and the day they cross this is the difference between a gap
  // and a silently wrong price.
  if (selected.length > 0 && band == null) {
    findings.push({
      level: 'warning',
      code: 'VAS_BELOW_FRAMEWORK_BAND',
      message: `Product pricing frameworks start at ${intake.currency} 500k monthly volume. This deal is ${intake.currency} ${Math.round(billableMonthlyTpv).toLocaleString('en-US')}.`,
      detail: 'No banded product price applies. Strategic Pricing sets the VAS fees below the framework floor.',
    });
  }

  // "Pricing for X is mandatory" appears in five of the six decks. A deal quoted
  // without them is not cheaper, it is incomplete.
  const mandatoryMissing = book.vas_catalogue
    .filter((fw) => fw.mandatory && !intake.vas[fw.key]?.enabled)
    .map((fw) => ({ key: fw.key, label: fw.label }));

  if (mandatoryMissing.length > 0) {
    findings.push({
      level: 'warning',
      code: 'VAS_MANDATORY_MISSING',
      message: `${mandatoryMissing.length} product${mandatoryMissing.length > 1 ? 's whose frameworks say pricing is mandatory are' : ' whose framework says pricing is mandatory is'} not on this deal: ${mandatoryMissing.map((m) => m.label).join(', ')}.`,
      detail:
        'Each of these frameworks states that its pricing is mandatory and that free trials are not allowed. Where the merchant takes the product it has to be priced — leaving it off is not a discount, it is a gap in the quote.',
    });
  }

  const selectedListPriceBps = lines.length === 0 || anyMissing ? null : roundBps(sum);
  return {
    frameworkOtherBps,
    selectedListPriceBps,
    deltaBps: selectedListPriceBps == null ? null : roundBps(selectedListPriceBps - frameworkOtherBps),
    anyUnverified,
    band,
    tier,
    tierReason,
    lines,
    mandatoryMissing,
  };
}

/**
 * The MAC gate. Runs whether or not the framework covers the merchant, because a
 * merchant the rate card cannot price still has to clear the same risk criteria.
 */
function buildMacCheck(
  intake: Intake,
  book: PricingBook,
  billableMonthlyTpvUsd: number | null,
  rateBps: number | null,
  findings: Finding[],
): MacCheck | null {
  if (!book.mac || book.mac.sectors.length === 0) return null;

  const monthlyNetRevenueUsd =
    billableMonthlyTpvUsd != null && rateBps != null ? billableMonthlyTpvUsd * (rateBps / 10_000) : null;

  const check = checkMac({ mac: book.mac, intake, monthlyNetRevenueUsd });
  if (check.sectors.length === 0) return check;

  const titles = check.sectors.map((s) => s.title).join(', ');
  findings.push({
    level: 'info',
    code: 'MAC_SECTOR',
    message: `Minimum Acceptance Criteria apply: ${titles}.`,
    detail: `${check.sectors.reduce((n, s) => n + s.criteria.length, 0)} criteria across ${check.sectors.length} sector(s). ${book.mac.source_locator}.`,
  });

  if (check.clearsNetRevenue === false) {
    findings.push({
      level: 'warning',
      code: 'MAC_BELOW_NET_REVENUE',
      message: `This deal produces about $${Math.round(check.monthlyNetRevenueUsd!).toLocaleString('en-US')} monthly net revenue, below the $${check.requiredMonthlyNetRevenueUsd!.toLocaleString('en-US')} the MAC expects for ${check.requiredBy}.`,
      detail:
        'The MAC requires a Minimum Billing where the merchant cannot demonstrate processing volume matching the expected net revenue. Set an MMB, or expect the MAF to be declined regardless of the rate.',
    });
  }

  if (check.clearsChargebacks === false) {
    findings.push({
      level: 'blocking',
      code: 'MAC_CHARGEBACKS',
      message: `Chargebacks at ${check.chargebackRatioPct}% are above the MAC's ${check.chargebackCeilingPct}% pre-submission ceiling.`,
      detail: `"${book.mac.chargeback_verbatim}" — the MAC says Commercial should not submit a MAF until this is answered yes. This also puts every product on its Other MCCs pricing table.`,
    });
  }

  if (check.requiredMonthlyNetRevenueUsd == null && check.sectors.length > 0) {
    findings.push({
      level: 'info',
      code: 'MAC_NO_NET_REVENUE_FLOOR',
      message: `The MAC states a tier rather than a dollar figure for ${titles}.`,
      detail: 'No net revenue floor is asserted here. Confirm the tier threshold with Risk before submitting.',
    });
  }

  return check;
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
