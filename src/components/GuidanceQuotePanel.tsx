'use client';

import { Fragment } from 'react';
import { SearchX } from 'lucide-react';
import { book } from '@/lib/book';
import { useQuote, useStore } from '@/lib/store';
import { bps, bpsAsPct, feeAmount, int, money, moneyCompact, pct } from '@/lib/format';
import type { MacCheck, Quote, VasLine, VasVerdict } from '@/lib/types';
import { Card, Chip, ConfidenceChip, FindingList, SourceLink, Tile } from './ui/primitives';

/**
 * Guidance take rate + waterfall. Shown on the merchant page after "Build the price".
 */
export function GuidanceQuotePanel() {
  const { intake, today } = useStore();
  const quote = useQuote();

  if (quote.status === 'UNMAPPED' || quote.status === 'BLOCKED') {
    return <NoGuidance quote={quote} today={today} />;
  }

  const cur = intake.currency;

  return (
    <div className="space-y-5" id="guidance-quote">
      <Card>
        {/*
          Two rates, side by side, answering two different questions:
          the recommendation is what to aim for, the adjusted rate is what the rep
          can defend given what is actually being sold. Neither is a discount on
          the other — approvals still measure the requested rate against guidance.
        */}
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <div className="chip-mono text-faint">Recommended take rate</div>
            <div className="mt-1.5 flex items-baseline gap-2.5">
              <span className="font-display text-5xl font-bold leading-none tnum text-lime">
                {bps(quote.targetBps)}
              </span>
              <span className="font-display text-xl font-bold leading-none text-muted">bps</span>
              <span className="tnum text-base text-muted">{bpsAsPct(quote.targetBps)}</span>
            </div>
            <p className="mt-2 text-[0.75rem] leading-snug text-faint">
              Acquirer Guidance · Cat {quote.band!.cat}. This is what approvals measure against.
            </p>
          </div>

          <AdjustedRateHeadline quote={quote} />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line px-5 py-3.5">
          <p className="max-w-xl text-[0.8125rem] leading-relaxed text-muted">
            {intake.merchantName || 'This merchant'} · {quote.match!.vertical} ·{' '}
            {quote.match!.country_scope ? `${quote.match!.region} (${quote.match!.country_scope})` : quote.match!.region}{' '}
            · {money(quote.billableMonthlyTpv, cur)}/month
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip tone="blue">Cat {quote.band!.cat}</Chip>
            {intake.riskLevel === 'HIGH' && <Chip tone="orange">High risk</Chip>}
            {intake.isGold && <Chip tone="lime">Gold</Chip>}
            <ConfidenceChip confidence={quote.match!.confidence} />
          </div>
        </div>

        <div className="border-t border-line">
          <table className="w-full text-left text-[0.8125rem]">
            <thead>
              <tr className="chip-mono text-faint">
                <th className="px-5 py-2 font-medium">Component</th>
                <th className="px-3 py-2 font-medium">As quoted in the source</th>
                <th className="px-3 py-2 text-right font-medium">bps</th>
                <th className="px-5 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.key} className="border-t border-line/60">
                  <td className="px-5 py-2.5">
                    <span className={l.category === 'rounding' ? 'text-faint' : 'font-medium text-ink'}>
                      {l.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{l.asQuoted}</td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold text-ink">{bps(l.bps)}</td>
                  <td className="px-5 py-2.5">
                    <SourceLink
                      sourceId={l.sourceId}
                      locator={l.sourceLocator}
                      verbatim={l.verbatim}
                      today={today}
                    />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong bg-sunken/60">
                <td className="px-5 py-3 font-semibold text-ink">Guidance total</td>
                <td className="px-3 py-3 tnum text-muted">{bpsAsPct(quote.targetBps)}</td>
                <td className="px-3 py-3 text-right tnum text-base font-bold text-lime">{bps(quote.targetBps)}</td>
                <td className="px-5 py-3" />
              </tr>
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-2.5 text-[0.6875rem] leading-relaxed text-faint">
            Hover a source to see the exact line it was read from. The framework&apos;s stated total is authoritative —
            components are shown for explanation and are not re-added to produce it.
          </p>
        </div>
      </Card>

      <FindingList findings={quote.findings} levels={['warning']} />

      {quote.macCheck && quote.macCheck.actions.length > 0 && <MacCard check={quote.macCheck} today={today} />}

      {quote.adjusted && quote.adjusted.totalBps != null && <AdjustedBuildUp quote={quote} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="The deal in numbers">
          <div className="grid grid-cols-2 gap-4 p-4">
            <Tile
              label="Volume to Checkout"
              value={moneyCompact(quote.billableMonthlyTpv, cur)}
              sub={`per month${intake.scopePct < 100 ? ` · ${intake.scopePct}% of ${moneyCompact(quote.effectiveMonthlyTpv, cur)}` : ''}`}
            />
            <Tile
              label="Transactions"
              value={quote.monthlyTxns == null ? '—' : int(quote.monthlyTxns)}
              sub={quote.monthlyTxns == null ? 'needs ATV' : 'per month'}
            />
            <Tile
              label="eMNR at guidance"
              value={moneyCompact((quote.billableMonthlyTpv ?? 0) * (quote.targetBps! / 10_000), cur)}
              sub="per month"
            />
            <Tile
              label="Annualized"
              value={moneyCompact((quote.billableMonthlyTpv ?? 0) * (quote.targetBps! / 10_000) * 12, cur)}
              sub="net revenue"
            />
          </div>
        </Card>

        <Card title="Matched framework row">
          <dl className="space-y-1.5 p-4 text-[0.75rem]">
            <Row k="Region" v={quote.match!.region} />
            <Row k="Vertical" v={quote.match!.vertical} />
            <Row k="Country scope" v={quote.match!.country_scope ?? 'regional default'} />
            <Row k="Risk level" v={quote.match!.risk_level} />
            <Row
              k="Volume band"
              v={`Cat ${quote.match!.cat} · $${quote.match!.monthly_tpv_band_musd.min}–${quote.match!.monthly_tpv_band_musd.max ?? '∞'}m`}
            />
            <Row k="Locator" v={quote.match!.source_locator} />
          </dl>
        </Card>
      </div>

      {quote.vasCheck && quote.vasCheck.lines.length > 0 && (
        <Card
          title="Product pricing frameworks"
          subtitle="Each product priced off its own framework — banded on monthly volume, tiered Standard or Other MCCs, with the floor and ceiling that decide who signs."
          right={
            <div className="flex flex-wrap justify-end gap-2">
              <Chip tone={quote.vasCheck.tier === 'other' ? 'orange' : 'neutral'} title={quote.vasCheck.tierReason}>
                {quote.vasCheck.tier === 'other' ? 'Other MCCs' : 'Standard MCCs'}
              </Chip>
              {quote.vasCheck.band ? (
                <Chip tone="blue" title="Product frameworks band on monthly processing volume in the deal currency.">
                  {cur} {quote.vasCheck.band.label}
                </Chip>
              ) : (
                <Chip tone="orange">Below the 500k framework floor</Chip>
              )}
              {quote.vasCheck.anyUnverified && <Chip tone="orange">Some products undocumented</Chip>}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem]">
              <thead>
                <tr className="chip-mono text-faint">
                  <th className="px-5 py-2 font-medium">Fee</th>
                  <th className="px-3 py-2 text-right font-medium">Floor</th>
                  <th className="px-3 py-2 text-right font-medium">Recommended</th>
                  <th className="px-3 py-2 text-right font-medium">Ceiling</th>
                  <th className="px-3 py-2 text-right font-medium">Quoting</th>
                  <th className="px-3 py-2 text-right font-medium">Attach</th>
                  <th className="px-3 py-2 text-right font-medium">bps</th>
                  <th className="px-5 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {quote.vasCheck.lines.map((l, i) => {
                  const newFramework = i === 0 || quote.vasCheck!.lines[i - 1].frameworkKey !== l.frameworkKey;
                  return (
                    <tr
                      key={`${l.frameworkKey}-${l.key}`}
                      className={newFramework ? 'border-t border-line' : 'border-t border-line/40'}
                    >
                      <td className="px-5 py-2.5">
                        {newFramework && (
                          <span className="block font-medium text-ink">{l.frameworkLabel}</span>
                        )}
                        <span className={newFramework ? 'text-[0.75rem] text-faint' : 'text-muted'}>{l.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum text-faint">
                        {l.floorWaived ? 'waived' : feeAmount(l.floor, l.currency, l.unit)}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum text-muted">
                        {feeAmount(l.recommended, l.currency, l.unit)}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum text-faint">
                        {feeAmount(l.ceiling, l.currency, l.unit)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <VerdictCell line={l} />
                      </td>
                      <td className="px-3 py-2.5 text-right tnum text-muted">
                        {l.unit === 'per_request' || l.unit === 'pct_of_value'
                          ? `${Math.round(l.attachRate * 100)}%`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum font-semibold text-ink">
                        {l.bps == null ? (
                          <span className="text-faint" title={l.notModelledReason ?? 'No rate to quote'}>
                            —
                          </span>
                        ) : (
                          bps(l.bps)
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <SourceLink sourceId={l.sourceId} locator={l.sourceLocator} today={today} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-3">
            <Tile label="Guidance assumes (Other)" value={`${bps(quote.vasCheck.frameworkOtherBps)} bps`} />
            <Tile
              label="Selected products"
              value={quote.vasCheck.selectedListPriceBps == null ? '—' : `${bps(quote.vasCheck.selectedListPriceBps)} bps`}
              sub={quote.vasCheck.selectedListPriceBps == null ? 'Needs ATV, or a product with no framework' : 'at the prices above'}
            />
            <Tile
              label="Gap"
              value={
                quote.vasCheck.deltaBps == null
                  ? '—'
                  : `${quote.vasCheck.deltaBps > 0 ? '+' : ''}${bps(quote.vasCheck.deltaBps)} bps`
              }
              tone={quote.vasCheck.deltaBps == null ? 'neutral' : quote.vasCheck.deltaBps < 0 ? 'orange' : 'lime'}
              sub={
                quote.vasCheck.deltaBps == null
                  ? undefined
                  : quote.vasCheck.deltaBps < 0
                    ? 'Bundle prices below what guidance assumes'
                    : 'Bundle covers the assumption'
              }
            />
          </div>
          <p className="border-t border-line px-5 py-2.5 text-[0.6875rem] leading-relaxed text-faint">
            Product prices do not change the guidance take rate — the framework&apos;s Other line already carries the VAS
            and FX uplift, so adding these on top would double-count it. What they do change is who has to approve:
            below a floor or above a ceiling is someone&apos;s signature.
          </p>
        </Card>
      )}

      {/* MAC now sits directly under the rates — it is step 2 of the rep's flow, not
          a footnote. Moved up rather than duplicated here. */}

      <FindingList findings={quote.findings} levels={['info']} />
    </div>
  );
}

/**
 * The right-hand rate. Empty until the rep has priced something — an adjusted rate
 * of "0 bps" before any input would read as a quote, which it is not.
 */
function AdjustedRateHeadline({ quote }: { quote: Quote }) {
  const a = quote.adjusted;

  if (!a || a.totalBps == null) {
    return (
      <div className="p-5">
        <div className="chip-mono text-faint">Sales rep adjusted take rate</div>
        <div className="mt-1.5 flex items-baseline gap-2.5">
          <span className="font-display text-5xl font-bold leading-none tnum text-faint">—</span>
        </div>
        <p className="mt-2 text-[0.75rem] leading-snug text-faint">
          Add core acquiring and value-added services below and this builds up from what you are actually selling.
        </p>
      </div>
    );
  }

  const delta = a.deltaVsRecommendedBps;
  const above = delta != null && delta > 0;

  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="chip-mono text-faint">Sales rep adjusted take rate</span>
        {delta != null && (
          <Chip tone={above ? 'lime' : 'orange'}>
            {above ? '+' : ''}
            {bps(delta)} bps vs recommended
          </Chip>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2.5">
        <span className="font-display text-5xl font-bold leading-none tnum text-blue-bright">{bps(a.totalBps)}</span>
        <span className="font-display text-xl font-bold leading-none text-muted">bps</span>
        <span className="tnum text-base text-muted">{bpsAsPct(a.totalBps)}</span>
      </div>
      <p className="mt-2 text-[0.75rem] leading-snug text-faint">
        Core acquiring {bps(a.coreAcquiringBps)} + value-added services {bps(a.vasBps)}
        {a.incomplete && <span className="text-orange"> · one or more lines could not be priced</span>}
      </p>
    </div>
  );
}

/** Line-by-line build-up of the adjusted rate. What the rep walks the merchant through. */
function AdjustedBuildUp({ quote }: { quote: Quote }) {
  const a = quote.adjusted!;
  const groups = [
    { key: 'core_acquiring' as const, label: 'Core acquiring' },
    { key: 'vas' as const, label: 'Value-added services' },
  ].filter((g) => a.components.some((c) => c.group === g.key));

  return (
    <Card
      title="Sales rep adjusted take rate — build-up"
      subtitle="What you are charging, line by line. This does not change the recommended rate above, and it is not a discount request — it is the rate you can justify from the value on the deal."
      right={
        a.deltaVsRecommendedBps != null ? (
          <Chip tone={a.deltaVsRecommendedBps > 0 ? 'lime' : 'orange'}>
            {a.deltaVsRecommendedBps > 0 ? 'above' : 'below'} recommended
          </Chip>
        ) : undefined
      }
    >
      <table className="w-full text-left text-[0.8125rem]">
        <thead>
          <tr className="chip-mono text-faint">
            <th className="px-5 py-2 font-medium">Component</th>
            <th className="px-3 py-2 font-medium">As entered</th>
            <th className="px-5 py-2 text-right font-medium">bps</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr className="border-t border-line bg-sunken/40">
                <td colSpan={3} className="chip-mono px-5 py-1.5 text-faint">
                  {g.label}
                </td>
              </tr>
              {a.components
                .filter((c) => c.group === g.key)
                .map((c) => (
                  <tr key={c.key} className="border-t border-line/50">
                    <td className="px-5 py-2 text-ink">{c.label}</td>
                    <td className="px-3 py-2 tnum text-muted">{c.asEntered}</td>
                    <td className="px-5 py-2 text-right tnum font-semibold text-ink">
                      {c.bps == null ? (
                        <span className="text-orange" title={c.blockedReason ?? undefined}>
                          not priced
                        </span>
                      ) : (
                        bps(c.bps)
                      )}
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
          <tr className="border-t-2 border-line-strong bg-sunken/60">
            <td className="px-5 py-2.5 font-semibold text-ink">Adjusted total</td>
            <td className="px-3 py-2.5 tnum text-muted">{bpsAsPct(a.totalBps)}</td>
            <td className="px-5 py-2.5 text-right tnum text-base font-bold text-blue-bright">{bps(a.totalBps)}</td>
          </tr>
          <tr className="border-t border-line/60">
            <td className="px-5 py-2 text-faint">Recommended take rate</td>
            <td className="px-3 py-2 tnum text-faint">{bpsAsPct(quote.targetBps)}</td>
            <td className="px-5 py-2 text-right tnum text-muted">{bps(quote.targetBps)}</td>
          </tr>
        </tbody>
      </table>
      {a.components.some((c) => c.bps == null) && (
        <p className="border-t border-line px-5 py-2.5 text-[0.75rem] leading-relaxed text-orange">
          {a.components.find((c) => c.bps == null)!.blockedReason} The total above understates the deal until that is
          resolved.
        </p>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-faint">{k}</dt>
      <dd className="tnum text-right text-muted">{v}</dd>
    </div>
  );
}

const VERDICT: Record<VasVerdict, { tone: 'lime' | 'orange' | 'blue' | 'neutral'; label: string; title: string }> = {
  at_recommended: { tone: 'lime', label: 'at guidance', title: 'Priced at the framework recommendation.' },
  above_recommended: {
    tone: 'lime',
    label: 'above rec.',
    title: 'Above the recommendation and inside the ceiling. No approval needed.',
  },
  below_recommended: {
    tone: 'blue',
    label: 'below rec.',
    title: 'Below the recommendation but above the floor. No approval needed.',
  },
  below_floor: { tone: 'orange', label: 'below floor', title: 'Below the framework floor — needs approval.' },
  above_ceiling: { tone: 'orange', label: 'above ceiling', title: 'Above the framework ceiling — needs approval.' },
  no_rate: { tone: 'neutral', label: 'no rate', title: 'This product has no framework price to quote.' },
};

function VerdictCell({ line }: { line: VasLine }) {
  const v = VERDICT[line.verdict];
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tnum font-semibold text-ink">{feeAmount(line.amount, line.currency, line.unit)}</span>
      <Chip tone={v.tone} title={line.approvers.length ? `${v.title} Needs ${line.approvers.join(' then ')}.` : v.title}>
        {line.quoted && line.verdict !== 'no_rate' ? `quoted · ${v.label}` : v.label}
      </Chip>
    </span>
  );
}

/**
 * The MAC gate.
 *
 * Placed after the rate rather than before it on purpose: a rep opens this tool to
 * get a number, and burying the number under a risk checklist would get the panel
 * scrolled past. But the net revenue test is the one thing here that can make the
 * rate irrelevant, so it leads the card.
 */
function MacCard({ check, today }: { check: MacCheck; today: string }) {
  const nrTone = check.clearsNetRevenue === false ? 'orange' : check.clearsNetRevenue === true ? 'lime' : 'neutral';
  const cbTone = check.clearsChargebacks === false ? 'orange' : check.clearsChargebacks === true ? 'lime' : 'neutral';

  return (
    <Card
      title="Minimum Acceptance Criteria"
      subtitle="What this merchant has to demonstrate before a MAF should be submitted. Not pricing — the gate underneath it."
      // Ten sectors is a normal result for a Retail merchant with no MCC, and ten
      // chips do not fit a card header. The full list is right below anyway.
      right={
        <div className="flex flex-wrap justify-end gap-2">
          {check.sectors.slice(0, 3).map((s) => (
            <Chip key={s.key} tone="purple" title={s.source_locator}>
              {s.title}
            </Chip>
          ))}
          {check.sectors.length > 3 && (
            <Chip tone="neutral" title={check.sectors.slice(3).map((s) => s.title).join(', ')}>
              +{check.sectors.length - 3} more
            </Chip>
          )}
        </div>
      }
    >
      <div className="grid gap-4 border-b border-line px-5 py-4 sm:grid-cols-3">
        <Tile
          label="Monthly net revenue"
          value={check.monthlyNetRevenueUsd == null ? '—' : moneyCompact(check.monthlyNetRevenueUsd, 'USD')}
          sub="at the rate on the table"
        />
        <Tile
          label="MAC expects"
          value={
            check.requiredMonthlyNetRevenueUsd == null
              ? 'tier only'
              : moneyCompact(check.requiredMonthlyNetRevenueUsd, 'USD')
          }
          tone={nrTone === 'neutral' ? 'neutral' : nrTone}
          sub={check.requiredBy ? `set by ${check.requiredBy}` : 'no dollar figure stated'}
        />
        <Tile
          label="Chargebacks"
          value={check.chargebackRatioPct == null ? '—' : pct(check.chargebackRatioPct, 2)}
          tone={cbTone === 'neutral' ? 'neutral' : cbTone}
          sub={
            check.chargebackRatioPct == null
              ? `ceiling ${pct(check.chargebackCeilingPct, 1)} — not supplied`
              : `ceiling ${pct(check.chargebackCeilingPct, 1)}`
          }
        />
      </div>

      {/*
        The actionable summary. This is what the rep reads: what to do, not what the
        deck says. The criteria themselves are 117 lines across nine candidate
        sectors for a merchant with no MCC — real, and behind a disclosure.
      */}
      <ul className="divide-y divide-line/50">
        {check.actions.map((a) => (
          <li key={a.key} className="flex gap-3 px-5 py-3">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background:
                  a.tone === 'blocking'
                    ? 'var(--color-orange)'
                    : a.tone === 'warning'
                      ? '#e8c33a'
                      : 'var(--color-line-strong)',
              }}
            />
            <div className="min-w-0">
              <p
                className={`text-[0.8125rem] font-medium leading-snug ${a.tone === 'blocking' ? 'text-orange' : 'text-ink'}`}
              >
                {a.label}
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted">{a.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <details className="border-t border-line">
        <summary className="cursor-pointer px-5 py-3 text-[0.75rem] text-faint">
          All criteria in full — {check.sectors.reduce((n, s) => n + s.criteria.length, 0)} across{' '}
          {check.sectors.length} sector{check.sectors.length > 1 ? 's' : ''}
          {check.sectors.length > 1 && ' · matched on vertical, enter the MCC to narrow it'}
        </summary>
        {check.sectors.map((s) => {
        const body = (
          <>
            {s.net_revenue_verbatim && (
              <p className="mt-1 text-[0.75rem] text-muted">
                <span className="text-faint">Net revenue: </span>
                {s.net_revenue_verbatim}
              </p>
            )}
            {s.mccs.length > 0 && <p className="mt-0.5 text-[0.75rem] text-faint">MCCs: {s.mccs.join(', ')}</p>}
            <ul className="mt-2 space-y-1.5">
              {s.criteria.map((c, i) => (
                <li key={i} className="flex gap-2 text-[0.75rem] leading-relaxed text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            {s.prohibited.length > 0 && (
              <ul className="mt-2.5 space-y-1 rounded-lg border border-orange/30 bg-orange/[0.06] px-3 py-2">
                {s.prohibited.map((p, i) => (
                  <li key={i} className="text-[0.75rem] leading-relaxed text-orange">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </>
        );

          // No nested disclosure — the enclosing one already gated this, and a
          // second click to reach the text reads as the tool hiding something.
          return (
            <div key={s.key} className="border-t border-line/50 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[0.875rem] font-semibold text-ink">
                  {s.title}
                  {s.min_monthly_net_revenue_usd != null && (
                    <span className="ml-2 text-[0.6875rem] font-normal text-faint">
                      {moneyCompact(s.min_monthly_net_revenue_usd, 'USD')} eNR
                    </span>
                  )}
                </h3>
                <SourceLink sourceId={book.mac.source_id} locator={s.source_locator} today={today} />
              </div>
              {body}
            </div>
          );
        })}
      </details>

      <details className="border-t border-line px-5 py-3">
        <summary className="cursor-pointer text-[0.75rem] text-faint">
          Commercial pre-submission checklist ({check.checklist.length} questions)
        </summary>
        <ul className="mt-2 space-y-1.5">
          {check.checklist.map((q, i) => (
            <li key={i} className="flex gap-2 text-[0.75rem] leading-relaxed text-muted">
              <span className="tnum shrink-0 text-faint">{i + 1}.</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function NoGuidance({ quote, today }: { quote: Quote; today: string }) {
  const blocking = quote.findings.filter((f) => f.level === 'blocking');

  return (
    <div className="space-y-5" id="guidance-quote">
      <Card>
        <div className="flex items-start gap-4 p-5">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange/15">
            <SearchX size={20} className="text-orange" />
          </span>
          <div>
            <h2 className="headline text-2xl text-ink">No guidance for this deal</h2>
            <p className="mt-2 max-w-xl text-[0.875rem] leading-relaxed text-muted">
              The Acquirer Guidance does not cover this combination, so there is no recommended take rate to quote or
              discount against. The tool will not approximate one from an adjacent row.
            </p>
          </div>
        </div>
      </Card>

      <FindingList findings={blocking} />

      {quote.searchedFor && (
        <Card title="What was searched">
          <dl className="grid gap-3 p-4 sm:grid-cols-2">
            {Object.entries(quote.searchedFor).map(([k, v]) => (
              <div key={k}>
                <dt className="chip-mono text-faint">{k}</dt>
                <dd className="mt-0.5 text-[0.8125rem] text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] text-faint">
            Sources searched: {book.sources.filter((s) => s.feeds === 'acquiring').map((s) => s.title).join(', ')} · book{' '}
            {book.version}
          </p>
        </Card>
      )}

      {quote.nearest.length > 0 && (
        <Card
          title="Adjacent rows — context only"
          subtitle="These are NOT guidance for this merchant. Shown so you can see what the framework does cover nearby."
        >
          <table className="w-full text-left text-[0.8125rem]">
            <thead>
              <tr className="chip-mono text-faint">
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-3 py-2 font-medium">Vertical</th>
                <th className="px-3 py-2 font-medium">Band</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.nearest.map((r) => (
                <tr key={r.id} className="border-t border-line/60 text-muted">
                  <td className="px-4 py-2">{r.region}</td>
                  <td className="px-3 py-2">{r.vertical}</td>
                  <td className="px-3 py-2 tnum">
                    ${r.monthly_tpv_band_musd.min}–{r.monthly_tpv_band_musd.max ?? '∞'}m
                  </td>
                  <td className="px-4 py-2 text-right tnum">{bps(r.total_bps)} bps</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* No guidance rate does not mean no criteria. A LATAM marketplace has the
          same MAC to clear as a covered one, and Strategic Pricing will ask. */}
      {quote.macCheck && quote.macCheck.sectors.length > 0 && <MacCard check={quote.macCheck} today={today} />}

      <Card title="Route this deal">
        <div className="space-y-3 p-4 text-[0.875rem] leading-relaxed text-muted">
          <p>
            Send it to your <strong className="text-ink">Regional Leader</strong> and{' '}
            <strong className="text-ink">Strategic Pricing</strong> for a bespoke quote.
          </p>
          <a href={`mailto:${book.approval_matrix.contact}`} className="btn btn-primary no-print">
            Email {book.approval_matrix.contact}
          </a>
        </div>
      </Card>
    </div>
  );
}
