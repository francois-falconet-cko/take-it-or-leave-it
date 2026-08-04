/**
 * Approval routing, transcribed from the Acquirer Guidance email of 27 Jul 2026.
 *
 * Two ladders, not one. Non-Gold deals escalate at 25% and 50% discount. Gold
 * deals — and any deal above $1bn — run a different ladder that starts with Team
 * Leader and Strategic Pricing even when the price is in line with guidance, and
 * that folds cash incentives into the escalation.
 *
 * Three things here are easy to miss and change the answer:
 *
 *   1. A Gold deal at guidance still needs sign-off. A non-Gold deal at guidance
 *      does not. "No discount" is not the same as "no approval".
 *   2. Above 25% discount the rep stops owning the approval email. Strategic
 *      Pricing owns it. That is a routing change, not just an extra name.
 *   3. Gold and Tier 1 deals cannot be actioned in QTC at all without written
 *      sign-off from Antoine or Guillaume, whatever the discount band says.
 *
 * Where the email is ambiguous, this module takes the conservative reading and
 * says so in `notes` rather than deciding silently.
 */

import type { ApprovalMatrix, ApprovalOutcome, ApproverRequirement, DiscountBand, Intake } from '../types.ts';

export interface ApprovalInput {
  matrix: ApprovalMatrix;
  discountPct: number;
  /** Annualized volume Checkout.com would process, in USD. Drives the $1bn trigger. */
  annualBillableTpvUsd: number | null;
  intake: Pick<
    Intake,
    'isGold' | 'cashIncentivesUsd' | 'freeProcessingMonths' | 'vasFreeTrialMonths' | 'spException'
  >;
}

function bandFor(bands: DiscountBand[], pct: number): DiscountBand | null {
  // Bands are half-open [min, max). A discount at exactly 25% is in the 25–50
  // band, once and only once.
  const clamped = Math.max(0, pct);
  return bands.find((b) => clamped >= b.min_pct && (b.max_pct == null || clamped < b.max_pct)) ?? null;
}

export function routeApproval(input: ApprovalInput): ApprovalOutcome {
  const { matrix, discountPct, annualBillableTpvUsd, intake } = input;
  const notes: string[] = [];

  // --- Which ladder? -------------------------------------------------------
  const overOneBillion =
    annualBillableTpvUsd != null && annualBillableTpvUsd >= matrix.gold_triggers.annual_tpv_usd_gte;
  const isGoldTrack = intake.isGold || overOneBillion;

  let goldReason: string | null = null;
  if (intake.isGold && overOneBillion) goldReason = 'Gold account, and annualized volume above $1bn';
  else if (intake.isGold) goldReason = 'Gold account';
  else if (overOneBillion) {
    goldReason = 'Annualized volume above $1bn';
    notes.push(matrix.gold_triggers.assumption);
  }

  const track: 'gold' | 'non_gold' = isGoldTrack ? 'gold' : 'non_gold';
  const bands = isGoldTrack ? matrix.discount_bands.gold : matrix.discount_bands.non_gold;

  // --- Pricing at or above guidance ---------------------------------------
  // Non-Gold: nothing to approve. Gold: the "in line, or up to 10%" band still
  // applies, so Team Leader and Strategic Pricing are still in the loop.
  const atOrAboveGuidance = discountPct <= 0;
  if (atOrAboveGuidance && !isGoldTrack) {
    return {
      required: false,
      track,
      goldReason,
      bandNote: 'At or above guidance take rate',
      approvers: [],
      managedBy: null,
      emailOwner: 'rep',
      qtcGate: null,
      spExceptionApplied: null,
      sideTracks: sideTracks(matrix, intake),
      notes: [
        'Priced at or above the Acquirer Guidance take rate — no discount approval required.',
        ...notes,
      ],
    };
  }

  const band = bandFor(bands, discountPct);
  const approvers: ApproverRequirement[] = [];
  let managedBy: string | null = null;
  let bandNote: string | null = null;

  if (band) {
    bandNote = band.note;
    managedBy = band.managed_by;
    const reason = atOrAboveGuidance
      ? 'Gold deal priced in line with guidance'
      : `${discountPct.toFixed(1)}% discount vs guidance — ${band.note.toLowerCase()}`;
    for (const name of band.approvers) approvers.push({ name, reason });
  } else {
    notes.push(
      `No discount band matched ${discountPct.toFixed(1)}%. Escalating to Strategic Pricing rather than guessing.`,
    );
    approvers.push({ name: 'Strategic Pricing', reason: 'Discount fell outside every documented band' });
    managedBy = 'Strategic Pricing';
  }

  // --- Cash incentives on the Gold ladder ---------------------------------
  // "Over 50% discount + cash incentives above 500k: CEO". Read conservatively:
  // either trigger reaches the CEO.
  const cash = intake.cashIncentivesUsd ?? 0;
  if (isGoldTrack && cash > 500_000 && !approvers.some((a) => a.name === 'CEO')) {
    approvers.push({ name: 'CEO', reason: `Cash incentives of $${cash.toLocaleString('en-US')} exceed $500k` });
    managedBy = 'Strategic Pricing';
    notes.push(
      'The guidance pairs "over 50% discount" with "cash incentives above 500k" in one line. Read here as either trigger reaching the CEO — confirm with Strategic Pricing.',
    );
  } else if (isGoldTrack && cash > 0 && discountPct >= 25) {
    notes.push(`Cash incentives of $${cash.toLocaleString('en-US')} are inside this band's scope.`);
  }

  // --- Strategic Pricing exceptions ---------------------------------------
  // SP can approve on behalf of the CRO, without CRO escalation, in two cases.
  let spExceptionApplied: string | null = null;
  const exceptionEligible =
    intake.spException === 'new_entity_only' ||
    (intake.spException === 'minor_adjustment_le_5pct' && discountPct <= 5);

  if (exceptionEligible && approvers.some((a) => a.name === 'CRO' || a.name === 'CEO')) {
    spExceptionApplied =
      intake.spException === 'new_entity_only' ? matrix.sp_exceptions[0] : matrix.sp_exceptions[1];
    notes.push(
      'Strategic Pricing can approve this on behalf of the CRO without escalation. The guidance does not say whether the Regional Leader step also falls away — confirm before skipping it.',
    );
    return {
      required: true,
      track,
      goldReason,
      bandNote,
      approvers: [{ name: 'Strategic Pricing', reason: 'Documented exception — approving on behalf of CRO' }],
      managedBy: 'Strategic Pricing',
      emailOwner: 'Strategic Pricing',
      qtcGate: isGoldTrack ? { signatories: matrix.qtc_gate.signatories, text: matrix.qtc_gate.text } : null,
      spExceptionApplied,
      sideTracks: sideTracks(matrix, intake),
      notes,
    };
  }

  // --- Who sends the email? -----------------------------------------------
  const emailOwner: 'rep' | 'Strategic Pricing' =
    discountPct > matrix.sp_routing_threshold_pct ? 'Strategic Pricing' : 'rep';
  if (emailOwner === 'Strategic Pricing') notes.push(matrix.sp_routing_note);

  return {
    required: true,
    track,
    goldReason,
    bandNote,
    approvers: dedupe(approvers),
    managedBy,
    emailOwner,
    qtcGate: isGoldTrack ? { signatories: matrix.qtc_gate.signatories, text: matrix.qtc_gate.text } : null,
    spExceptionApplied,
    sideTracks: sideTracks(matrix, intake),
    notes,
  };
}

/**
 * Free processing and VAS free trials run their own approval ladder, separate
 * from the discount one — a deal can be in line on take rate and still need the
 * CRO because someone promised four months free.
 */
function sideTracks(
  matrix: ApprovalMatrix,
  intake: Pick<Intake, 'freeProcessingMonths' | 'vasFreeTrialMonths'>,
): { label: string; approvers: string[]; note: string }[] {
  const out: { label: string; approvers: string[]; note: string }[] = [];
  const months = Math.max(intake.freeProcessingMonths ?? 0, intake.vasFreeTrialMonths ?? 0);
  if (months <= 0) return out;

  const band =
    months <= 3
      ? matrix.vas_free_trial_bands.find((b) => b.max_months === 3)
      : matrix.vas_free_trial_bands.find((b) => b.min_months === 4);

  if (band) {
    out.push({
      label: `Free processing / VAS free trial — ${months} month${months === 1 ? '' : 's'}`,
      approvers: band.approvers,
      note: `${band.note}. Free processing excludes ${matrix.free_processing_excludes.join(', ')}.`,
    });
  }
  return out;
}

function dedupe(approvers: ApproverRequirement[]): ApproverRequirement[] {
  const seen = new Map<string, ApproverRequirement>();
  for (const a of approvers) if (!seen.has(a.name)) seen.set(a.name, a);
  return [...seen.values()];
}

/** Seniority order, so a chain always reads Team Leader -> Regional -> CRO -> CEO. */
const RANK = ['Team Leader', 'Strategic Pricing', 'Regional Revenue Leader', 'Regional Leader', 'CRO', 'CEO'];

export function sortApprovers(approvers: ApproverRequirement[]): ApproverRequirement[] {
  return [...approvers].sort((a, b) => {
    const ia = RANK.indexOf(a.name);
    const ib = RANK.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** Highest approver in the chain, for the headline badge. */
export function topApprover(outcome: ApprovalOutcome): string | null {
  if (!outcome.required || outcome.approvers.length === 0) return null;
  return sortApprovers(outcome.approvers).at(-1)!.name;
}
