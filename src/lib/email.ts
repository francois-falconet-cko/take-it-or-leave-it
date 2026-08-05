/**
 * Approval email generation.
 *
 * The tool drafts. A human reads it and sends it. There is deliberately no mail
 * API here and no auto-send path — an approval request that a rep did not read
 * before it went out is worse than no tool at all.
 *
 * Above the Strategic Pricing routing threshold the recipient changes: per the
 * Acquirer Guidance, "any variance over 25% needs strategic oversight — contact
 * Strategic Pricing and they'll manage the approval email to CRO/CEO". So the
 * rep emails Strategic Pricing, not the CRO.
 */

import type { Intake, PricingBook, Quote } from './types.ts';
import { bps, bpsAsPct, feeAmount, money, pct } from './format.ts';

/**
 * Outlook and Gmail both stop reading a mailto: URL somewhere around 2,048
 * characters, and they truncate silently — the mail window just opens with the
 * end of the request missing. The limit applies to the whole percent-encoded
 * href, not the raw body, and encoding a plain-text email with newlines and
 * aligned columns inflates it by roughly 65%. So measure the href.
 */
export const MAILTO_HREF_LIMIT = 2000;

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  /** Who the rep actually sends this to, and why. */
  routing: string;
  /** False when the full body would be silently truncated by the mail client. */
  mailtoSafe: boolean;
  /** Full draft. Only use when mailtoSafe. */
  mailtoHref: string;
  /** Recipient and subject only, for when the full body will not fit. */
  mailtoHrefShort: string;
}

export function buildEmail(
  intake: Intake,
  quote: Quote,
  book: PricingBook,
  reasonCategory: string,
  justification: string,
): EmailDraft | null {
  if (!quote.approval || quote.targetBps == null || quote.requestedBps == null) return null;

  const a = quote.approval;
  const cur = intake.currency;
  const chain = a.approvers.map((x) => x.name);
  const spOwns = a.emailOwner === 'Strategic Pricing';

  const to = spOwns ? book.approval_matrix.contact : chain.join(', ');
  const greeting = spOwns ? 'Hi Strategic Pricing team,' : `Hi ${chain.join(' / ') || 'team'},`;

  const routing = spOwns
    ? `${pct(quote.discountPct)} discount is above the ${book.approval_matrix.sp_routing_threshold_pct}% threshold — Strategic Pricing manages the approval email to ${chain.join(' and ')}.`
    : `Send directly to ${chain.join(' and ')}.`;

  const ask = spOwns
    ? `I am requesting ${bps(quote.requestedBps)} bps for ${intake.merchantName || 'this merchant'}, a ${pct(quote.discountPct)} discount to the Acquirer Guidance rate of ${bps(quote.targetBps)} bps. This is above the ${book.approval_matrix.sp_routing_threshold_pct}% threshold, so I am routing it to you for oversight and approval by ${chain.join(' and ')}.`
    : `I am requesting ${bps(quote.requestedBps)} bps Take Rate for ${intake.merchantName || 'this merchant'}, a ${pct(quote.discountPct)} discount to the Acquirer Guidance rate of ${bps(quote.targetBps)} bps. This requires approval from ${chain.join(' and ')}.`;

  const lines: string[] = [];
  lines.push(greeting, '', ask, '');

  lines.push(`Annual net revenue at risk vs guidance: ${money(quote.annualRevenueAtRisk, cur)}`);
  if (a.track === 'gold') lines.push(`Deal track: Gold${a.goldReason ? ` — ${a.goldReason}` : ''}`);
  if (a.bandNote) lines.push(`Approval band: ${a.bandNote}`);
  lines.push('');

  if (reasonCategory || justification) {
    lines.push('Rationale:');
    if (reasonCategory) lines.push(`  ${reasonCategory}`);
    if (justification) lines.push(...wrap(justification, 76).map((l) => `  ${l}`));
    lines.push('');
  }

  lines.push('Merchant information:');
  const rows: [string, string][] = [
    ['Merchant', intake.merchantName || '—'],
    ['URL', intake.merchantUrl || '—'],
    ['MCC / vertical', `${intake.mcc || '—'} — ${intake.vertical || '—'}`],
    ['Region / entity', intake.countryScope ? `${intake.region} (${intake.countryScope})` : intake.region],
    ['Risk level', intake.riskLevel === 'HIGH' ? 'High risk' : 'Standard'],
    ['Platform', intake.platform || '—'],
    ['Current provider(s)', intake.currentProviders || '—'],
    ['Monthly processing volume', money(quote.effectiveMonthlyTpv, cur)],
    ['Annual revenue (TPV)', money(intake.annualTpv ?? (quote.effectiveMonthlyTpv ?? 0) * 12, cur)],
    [
      'Scope of volume',
      `${intake.scopePct}%${intake.scopeNote ? ` — ${intake.scopeNote}` : ''} (${money(quote.billableMonthlyTpv, cur)}/month to Checkout.com)`,
    ],
    ['Volume band', quote.band ? `Cat ${quote.band.cat} ($${quote.band.min}m–${quote.band.max ? `${quote.band.max}m` : '∞'}/month)` : '—'],
    ['Contract term', intake.contractTerm || '—'],
    ['Monthly Minimum Bill', intake.mmb ? money(intake.mmb, cur) : '—'],
    ['Expected eMNR (monthly)', money(quote.emnrMonthly, cur)],
    ['Expected eMNR (annual)', money(quote.emnrAnnual, cur)],
  ];
  if (intake.cashIncentivesUsd) rows.push(['Cash incentives', money(intake.cashIncentivesUsd, 'USD')]);
  if (intake.currentAcceptanceRate) rows.push(['Current acceptance rate', `${intake.currentAcceptanceRate}%`]);

  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  for (const [k, v] of rows) lines.push(`  ${(k + ':').padEnd(width)}${v}`);
  lines.push('');

  // Guidance build-up, so the approver can see where the target came from without
  // opening the framework themselves.
  lines.push('Guidance build-up:');
  for (const l of quote.lines) {
    lines.push(`  ${(l.label + ':').padEnd(width)}${bpsAsPct(l.bps)}  (${bps(l.bps)} bps)`);
  }
  lines.push(`  ${'Guidance total:'.padEnd(width)}${bpsAsPct(quote.targetBps)}  (${bps(quote.targetBps)} bps)`);
  lines.push(`  ${'Requested:'.padEnd(width)}${bpsAsPct(quote.requestedBps)}  (${bps(quote.requestedBps)} bps)`);
  lines.push('');

  // VAS priced outside its framework range is a separate approval with a separate
  // approver — a Regional Revenue Leader signs a below-floor 3DS fee whether or not
  // the take rate itself needed anyone. Putting it in the same email is what stops
  // a rep getting a take-rate approval and then discovering the fee needs another.
  const outOfRange = (quote.vasCheck?.lines ?? []).filter(
    (l) => l.verdict === 'below_floor' || l.verdict === 'above_ceiling',
  );
  if (outOfRange.length) {
    lines.push('Product pricing outside the framework range — separate approval:');
    for (const l of outOfRange) {
      const bound = l.verdict === 'below_floor' ? `floor ${l.floor}` : `ceiling ${l.ceiling}`;
      lines.push(
        `  ${l.frameworkLabel} — ${l.label}: ${l.amount} vs ${bound}` +
          (l.approvers.length ? ` — needs ${l.approvers.join(' then ')}` : ''),
      );
    }
    lines.push('');
  }

  if (quote.vasCheck && quote.vasCheck.lines.length) {
    lines.push(
      `Value-added services quoted (${quote.vasCheck.tier === 'other' ? 'Other' : 'Standard'} MCCs, ${cur} ${quote.vasCheck.band?.label ?? 'no band'}):`,
    );
    for (const l of quote.vasCheck.lines) {
      if (l.amount == null) continue;
      lines.push(
        `  ${(l.frameworkLabel + ' — ' + l.label + ':').padEnd(width + 26)}${feeAmount(l.amount, l.currency, l.unit)}${l.bps == null ? '' : `  (${bps(l.bps)} bps)`}`,
      );
    }
    lines.push('');
  }

  if (quote.macCheck && quote.macCheck.sectors.length) {
    const m = quote.macCheck;
    lines.push(`Minimum Acceptance Criteria — ${m.sectors.map((s) => s.title).join(', ')}:`);
    if (m.requiredMonthlyNetRevenueUsd != null) {
      lines.push(
        `  Expected monthly net revenue floor: USD ${m.requiredMonthlyNetRevenueUsd.toLocaleString('en-US')} (${m.requiredBy})`,
      );
      lines.push(
        `  This deal at the requested rate:    USD ${Math.round(m.monthlyNetRevenueUsd ?? 0).toLocaleString('en-US')}${m.clearsNetRevenue === false ? '  — BELOW THE MAC FLOOR' : ''}`,
      );
    }
    if (m.chargebackRatioPct != null) {
      lines.push(
        `  Chargeback ratio: ${m.chargebackRatioPct}% against a ${m.chargebackCeilingPct}% ceiling${m.clearsChargebacks === false ? '  — OVER THE CEILING' : ''}`,
      );
    }
    lines.push('');
  }

  if (a.sideTracks.length) {
    lines.push('Separate approvals required:');
    for (const t of a.sideTracks) lines.push(`  ${t.label} — ${t.approvers.join(', ')}`);
    lines.push('');
  }

  if (a.qtcGate) {
    lines.push(
      `Note: this is a ${a.track === 'gold' ? 'Gold' : 'Tier 1'} deal. Written approval from ${a.qtcGate.signatories.join(' or ')} must be in place before anything is actioned in QTC.`,
      '',
    );
  }

  if (a.spExceptionApplied) {
    lines.push(`Exception applied: ${a.spExceptionApplied}`, '');
  }

  const warnings = quote.findings.filter((f) => f.level === 'warning');
  if (warnings.length) {
    lines.push('Flags from the pricing tool:');
    for (const w of warnings) lines.push(`  - ${w.message}`);
    lines.push('');
  }

  lines.push(
    `Pricing basis: Acquirer Guidance, book ${book.version}${quote.match ? ` (${quote.match.source_locator})` : ''}`,
    '',
    'Please let me know if you require any additional information.',
    '',
    'Best,',
    intake.repName || '[your name]',
  );

  const body = lines.join('\n');
  const subject = `Frontbook Approval Request: ${intake.merchantName || 'New merchant'} — ${bps(quote.requestedBps)} bps (${pct(quote.discountPct)} discount)`;
  const mailto = (b: string) =>
    `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;

  const mailtoHref = mailto(body);

  return {
    to,
    subject,
    body,
    routing,
    mailtoSafe: mailtoHref.length <= MAILTO_HREF_LIMIT,
    mailtoHref,
    // A full front-book request runs past what a mail client will carry in a URL,
    // so the fallback opens an addressed, subject-filled compose window and the
    // rep pastes the body they just copied. Better than a button that does nothing.
    mailtoHrefShort: mailto('[Paste the approval request here — it is on your clipboard.]'),
  };
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      if (line) out.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) out.push(line.trim());
  return out.length ? out : [''];
}
