'use client';

import { ArrowLeft, ArrowRight, Check, SearchX } from 'lucide-react';
import { useQuote, useStore } from '@/lib/store';
import { book } from '@/lib/book';
import { bps, bpsAsPct, int, money, moneyCompact, unitLabel } from '@/lib/format';
import type { Quote } from '@/lib/types';
import { Card, Chip, ConfidenceChip, FindingList, SourceLink, Tile } from './ui/primitives';

export function RecommendationScreen() {
  const { intake, setStep, setRequestedBps, today } = useStore();
  const quote = useQuote();

  if (quote.status === 'UNMAPPED' || quote.status === 'BLOCKED') {
    return <NoGuidance quote={quote} onBack={() => setStep('intake')} />;
  }

  const cur = intake.currency;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        {/* --- The number --------------------------------------------------- */}
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-6 p-5">
            <div>
              <div className="chip-mono text-faint">Acquirer Guidance take rate</div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="font-display text-6xl font-bold leading-none tnum text-lime">
                  {bps(quote.targetBps)}
                </span>
                <span className="font-display text-2xl font-bold leading-none text-muted">bps</span>
                <span className="tnum text-lg text-muted">{bpsAsPct(quote.targetBps)}</span>
              </div>
              <p className="mt-2.5 max-w-xl text-[0.8125rem] leading-relaxed text-muted">
                {intake.merchantName || 'This merchant'} · {quote.match!.vertical} ·{' '}
                {quote.match!.country_scope ? `${quote.match!.region} (${quote.match!.country_scope})` : quote.match!.region}{' '}
                · Cat {quote.band!.cat} ({money(quote.billableMonthlyTpv, cur)}/month)
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Chip tone="blue">Cat {quote.band!.cat}</Chip>
              {intake.riskLevel === 'HIGH' && <Chip tone="orange">High risk</Chip>}
              {intake.isGold && <Chip tone="lime">Gold</Chip>}
              <ConfidenceChip confidence={quote.match!.confidence} />
            </div>
          </div>

          {/* --- Waterfall -------------------------------------------------- */}
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

        {/* --- VAS attach check ------------------------------------------- */}
        {quote.vasCheck && quote.vasCheck.lines.length > 0 && (
          <Card
            title="VAS attach check"
            subtitle="Does the selected bundle plausibly deliver the VAS and FX revenue the guidance assumes in its Other line?"
            right={quote.vasCheck.anyUnverified ? <Chip tone="orange">List prices unverified</Chip> : undefined}
          >
            <table className="w-full text-left text-[0.8125rem]">
              <thead>
                <tr className="chip-mono text-faint">
                  <th className="px-5 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">List price</th>
                  <th className="px-3 py-2 text-right font-medium">Attach</th>
                  <th className="px-3 py-2 text-right font-medium">bps</th>
                  <th className="px-5 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {quote.vasCheck.lines.map((l) => (
                  <tr key={l.key} className="border-t border-line/60">
                    <td className="px-5 py-2.5 font-medium text-ink">{l.label}</td>
                    <td className="px-3 py-2.5 text-muted">{unitLabel(l.unit, l.amount, l.currency)}</td>
                    <td className="px-3 py-2.5 text-right tnum text-muted">
                      {l.unit === 'per_request' ? `${Math.round(l.attachRate * 100)}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tnum font-semibold text-ink">
                      {l.bps == null ? <span className="text-faint">—</span> : bps(l.bps)}
                    </td>
                    <td className="px-5 py-2.5">
                      <SourceLink sourceId={l.sourceId} locator={l.notes} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-3">
              <Tile label="Guidance assumes (Other)" value={`${bps(quote.vasCheck.frameworkOtherBps)} bps`} />
              <Tile
                label="Selected list prices"
                value={quote.vasCheck.selectedListPriceBps == null ? '—' : `${bps(quote.vasCheck.selectedListPriceBps)} bps`}
                sub={quote.vasCheck.selectedListPriceBps == null ? 'Needs ATV and extracted list prices' : undefined}
              />
              <Tile
                label="Gap"
                value={quote.vasCheck.deltaBps == null ? '—' : `${quote.vasCheck.deltaBps > 0 ? '+' : ''}${bps(quote.vasCheck.deltaBps)} bps`}
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
              Advisory only — it does not change the target rate. The Acquirer Guidance moves away from per-product fees
              toward one blended take rate, so adding list prices on top of the total would double-count.{' '}
              {quote.vasCheck.anyUnverified && (
                <span className="text-orange">
                  These list prices are placeholders. Run the Glean refresh to extract the real ones from Highspot.
                </span>
              )}
            </p>
          </Card>
        )}

        <FindingList findings={quote.findings} levels={['info']} />
      </div>

      {/* --- Right rail ---------------------------------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
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
            {intake.mmb != null && (
              <Tile
                label="MMB floor"
                value={quote.mmbImpliedFloorBps == null ? '—' : `${bps(quote.mmbImpliedFloorBps)} bps`}
                sub={`${money(intake.mmb, cur)}/month`}
                tone={quote.mmbImpliedFloorBps && quote.mmbImpliedFloorBps > quote.targetBps! ? 'orange' : 'neutral'}
              />
            )}
            <Tile
              label="Framework basket"
              value={quote.match!.reference_atv == null ? '—' : String(quote.match!.reference_atv)}
              sub={`yours: ${intake.atv ?? '—'}`}
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
          <div className="border-t border-line px-4 py-3">
            <p className="font-mono text-[0.6875rem] leading-relaxed text-faint">{quote.match!.verbatim}</p>
          </div>
        </Card>

        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => {
              setRequestedBps(quote.targetBps);
              setStep('deal');
            }}
          >
            <Check size={15} />
            Accept {bps(quote.targetBps)} bps
          </button>
          <button type="button" className="btn btn-ghost w-full" onClick={() => setStep('challenge')}>
            Challenge the rate
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full !border-transparent !text-muted"
            onClick={() => setStep('intake')}
          >
            <ArrowLeft size={14} />
            Back to merchant
          </button>
        </div>
      </aside>
    </div>
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

/**
 * The refusal state. A tool that cannot say "there is no guidance for this" will
 * eventually price a LATAM marketplace off a European retail row, so this screen
 * gets the same design attention as the happy path.
 */
function NoGuidance({ quote, onBack }: { quote: Quote; onBack: () => void }) {
  const blocking = quote.findings.filter((f) => f.level === 'blocking');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <div className="flex items-start gap-4 p-5">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange/15">
            <SearchX size={20} className="text-orange" />
          </span>
          <div>
            <h1 className="headline text-2xl text-ink">No guidance for this deal</h1>
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

      <button type="button" className="btn btn-ghost" onClick={onBack}>
        <ArrowLeft size={14} />
        Change the merchant details
      </button>
    </div>
  );
}
