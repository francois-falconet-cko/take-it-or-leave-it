/**
 * Minimum Acceptance Criteria — the gate under the pricing conversation.
 *
 * The MAC is a risk document, not a rate card, and that is exactly why it belongs
 * in a pricing tool. It says what a merchant in a high-risk sector has to
 * demonstrate before Commercial should submit a MAF at all, including a floor on
 * expected monthly Net Revenue. A deal that cannot clear its sector's eNR floor is
 * not a discount conversation — it is a deal that will be declined weeks later,
 * after the rep has already quoted a rate.
 *
 * So this runs on every quote, and it uses a number the engine already has: eMNR.
 * Where the MAC says $7.5k monthly net revenue and the deal produces $4k, the tool
 * says so on the same screen as the rate.
 *
 * Two deliberate restraints:
 *
 *   - Where the deck states a tier without a dollar figure ("Tier 3 and above"),
 *     no floor is asserted. Four sectors are like this. Inventing a number to fill
 *     the gap would put a fabricated threshold in front of a rep.
 *   - Matching is by vertical and by MCC, and it is over-inclusive by design. A
 *     sector shown that does not apply costs ten seconds of reading; a sector
 *     missed means a deal clears a gate it should not have.
 */

import type { Intake, MacAction, MacBook, MacCheck, MacSector } from '../types.ts';

/**
 * Sectors governing this merchant.
 *
 * Two weak signals, and the interesting case is when they agree.
 *
 * An MCC alone is not enough. MCCs are reused across sectors — 5817 is digital
 * applications and also how a prop firm books itself when there is no educational
 * element — and several sectors hedge their list outright ("Common MCCs used",
 * "Multiple"). Pinning on 5999 would tell a misc-retail merchant it is selling CBD.
 *
 * A vertical alone is not enough either. It is our own mapping, not the deck's, and
 * "Retail" legitimately spans ten sectors.
 *
 * So a sector is treated as identified only when the MCC list is unhedged AND the
 * vertical agrees with it. Anything less returns the union as candidates, MCC hits
 * first, and the rep picks. Long candidate lists are the honest outcome there —
 * the UI collapses them rather than the engine pretending to know.
 */
export function macSectorsFor(mac: MacBook, intake: Intake): MacSector[] {
  const mcc = intake.mcc.trim();
  const vertical = intake.vertical;
  const byNumber = (a: MacSector, b: MacSector) => a.number - b.number;

  const byMcc = mcc === '' ? [] : mac.sectors.filter((s) => s.mccs.includes(mcc));
  const byVertical = vertical === '' ? [] : mac.sectors.filter((s) => s.verticals.includes(vertical));

  const pinned = byMcc.filter(
    (s) => s.mccs_exclusive && (vertical === '' || s.verticals.length === 0 || s.verticals.includes(vertical)),
  );
  if (pinned.length > 0) return pinned.sort(byNumber);

  const seen = new Set<string>();
  return [...byMcc, ...byVertical].filter((s) => !seen.has(s.key) && seen.add(s.key));
}

/**
 * Themes worth surfacing as an action, and the words the MAC uses for them.
 *
 * The MAC states its criteria as prose, and there are 117 of them for a merchant
 * with no MCC. What a rep needs off that is not the prose — it is "this deal needs
 * a licence" and "processing history will be asked for". So the criteria are
 * scanned for a handful of recurring themes and collapsed to one line each.
 *
 * This summarises; it does not replace. The full criteria stay on the quote behind
 * a disclosure and on the printed page when a single sector is pinned, because the
 * summary is a prompt for the conversation and the criteria are the actual gate.
 */
/** Named themes before the rest collapse into one line. */
const MAX_NAMED_THEMES = 3;

const THEMES: { key: string; label: string; match: RegExp }[] = [
  { key: 'licence', label: 'Licences or legal opinions required', match: /licen[cs]|registration|legal opinion/i },
  { key: 'aml', label: 'AML / financial crime programme required', match: /\bAML\b|CTF|financial crime|money launder/i },
  { key: 'history', label: 'Card processing history will be requested', match: /processing history|processing statement|months of card processing/i },
  { key: 'financials', label: 'Audited financials or credit rating required', match: /audited|financial statement|credit rating|EBITDA|current ratio/i },
  { key: 'disputes', label: 'Fraud and chargeback thresholds apply', match: /chargeback|dispute ratio|fraud.{0,20}(rate|threshold)|VAMP|VFMP/i },
  { key: 'funds', label: 'Client fund segregation or safeguarding required', match: /segregat|safeguard|client fund/i },
  { key: 'geo', label: 'Geographic or jurisdiction restrictions apply', match: /geoblock|jurisdiction|in-scope countr|BIN blocked|not currently supported/i },
  { key: 'reserves', label: 'Rolling reserve likely', match: /rolling reserve/i },
  { key: 'controls', label: 'Monitoring and internal controls required', match: /internal control|monitoring|screening capabilit/i },
];

/**
 * The short version. Ordered so the two quantitative gates lead — those are the
 * ones a rep can act on inside this tool, by setting an MMB or checking a number.
 */
export function macActions(mac: MacBook, check: Omit<MacCheck, 'actions'>): MacAction[] {
  const actions: MacAction[] = [];
  if (check.sectors.length === 0) return actions;

  if (check.requiredMonthlyNetRevenueUsd != null) {
    const req = check.requiredMonthlyNetRevenueUsd;
    const short = req % 1000 === 0 ? `$${req / 1000}k` : `$${req.toLocaleString('en-US')}`;
    if (check.clearsNetRevenue === false) {
      actions.push({
        key: 'mmb',
        label: `Minimum MMB requirement: ${short}/month`,
        detail: `This deal produces about $${Math.round(check.monthlyNetRevenueUsd ?? 0).toLocaleString('en-US')} of monthly net revenue, below the ${short} ${check.requiredBy} expects. Set a Monthly Minimum Bill or the MAF will be declined on revenue, not on rate.`,
        tone: 'blocking',
      });
    } else {
      actions.push({
        key: 'mmb',
        label: `Minimum commitment required: ${short}/month net revenue`,
        detail: `${check.requiredBy}. The MAC requires a Minimum Billing where the merchant cannot demonstrate processing volume matching the expected net revenue — this deal clears it at the current rate, so hold the rate or add an MMB.`,
        tone: 'info',
      });
    }
  } else {
    actions.push({
      key: 'mmb',
      label: 'Minimum tier applies — no dollar figure published',
      detail: `The MAC states a tier rather than an amount for ${check.sectors.map((s) => s.title).join(', ')}. Confirm the threshold with Risk before submitting.`,
      tone: 'warning',
    });
  }

  if (check.clearsChargebacks === false) {
    actions.push({
      key: 'chargebacks',
      label: `Chargebacks must be below ${check.chargebackCeilingPct}%`,
      detail: `Currently ${check.chargebackRatioPct}%. "${mac.chargeback_verbatim}" — do not submit a MAF until this is answered yes.`,
      tone: 'blocking',
    });
  } else if (check.chargebackRatioPct == null) {
    actions.push({
      key: 'chargebacks',
      label: `Confirm chargebacks are below ${check.chargebackCeilingPct}%`,
      detail:
        'Not supplied. It decides two things: above 1% every product prices off its Other MCCs table, and above the MAC ceiling the deal should not be submitted at all.',
      tone: 'warning',
    });
  }

  // Bullets that are headings rather than statements — "Prohibited:", "CRB (US)
  // Approval and Prohibited Categories::" — survive the parser because they carry
  // the keyword. They are useless as examples, so they are shown as a count only.
  const prohibited = check.sectors
    .flatMap((s) => s.prohibited)
    .filter((p) => p.length > 30 && !/:$|::$/.test(p.trim()));

  if (prohibited.length > 0) {
    // Two examples, not thirteen. Joining every prohibited-model line produced a
    // paragraph nobody reads inside a summary whose whole job is being short.
    const sample = prohibited.slice(0, 2).map((p) => p.replace(/\s+/g, ' ').slice(0, 110));
    actions.push({
      key: 'prohibited',
      label: `Check the merchant is not one of ${prohibited.length} prohibited business model${prohibited.length > 1 ? 's' : ''}`,
      detail: `${sample.join(' · ')}${prohibited.length > sample.length ? ` — and ${prohibited.length - sample.length} more in the full criteria below.` : ''}`,
      tone: 'warning',
    });
  }

  // Themes, capped. Every theme fires once eight candidate sectors are in scope,
  // and eleven bullets is not a summary — it is the same wall of text with the
  // sentences shortened. Three named, the rest rolled into one line the rep can
  // open. The full criteria are always one disclosure away.
  const allCriteria = check.sectors.flatMap((s) => s.criteria);
  const matched = THEMES.filter((t) => allCriteria.some((c) => t.match.test(c)));

  for (const theme of matched.slice(0, MAX_NAMED_THEMES)) {
    actions.push({
      key: theme.key,
      label: theme.label,
      detail: allCriteria.find((c) => theme.match.test(c))!,
      tone: 'info',
    });
  }

  const rest = matched.slice(MAX_NAMED_THEMES);
  if (rest.length > 0) {
    actions.push({
      key: 'more',
      label: 'Additional pricing considerations apply',
      detail: `${rest.map((t) => t.label.replace(/ (required|apply|likely|will be requested)$/i, '')).join(' · ')}. ${allCriteria.length} criteria in full across ${check.sectors.length} sector${check.sectors.length > 1 ? 's' : ''}.`,
      tone: 'info',
    });
  }

  return actions;
}

export interface MacInput {
  mac: MacBook;
  intake: Intake;
  /** Monthly net revenue in USD at the rate being evaluated, or null when unknown. */
  monthlyNetRevenueUsd: number | null;
}

export function checkMac({ mac, intake, monthlyNetRevenueUsd }: MacInput): MacCheck {
  const sectors = macSectorsFor(mac, intake);

  // The binding floor is the highest one across matched sectors: a merchant that
  // sits in two sectors has to satisfy both, so the stricter one governs.
  const withFloor = sectors.filter((s) => s.min_monthly_net_revenue_usd != null);
  const binding = withFloor.reduce<MacSector | null>(
    (acc, s) => (acc == null || s.min_monthly_net_revenue_usd! > acc.min_monthly_net_revenue_usd! ? s : acc),
    null,
  );
  const required = binding?.min_monthly_net_revenue_usd ?? null;

  const cb = intake.chargebackRatioPct;

  const base = {
    sectors,
    monthlyNetRevenueUsd,
    requiredMonthlyNetRevenueUsd: required,
    requiredBy: binding?.title ?? null,
    clearsNetRevenue:
      required == null || monthlyNetRevenueUsd == null ? null : monthlyNetRevenueUsd >= required,
    chargebackCeilingPct: mac.chargeback_ceiling_pct,
    chargebackRatioPct: cb,
    clearsChargebacks: cb == null ? null : cb <= mac.chargeback_ceiling_pct,
    checklist: mac.pre_submission_checklist,
  };

  return { ...base, actions: macActions(mac, base) };
}
