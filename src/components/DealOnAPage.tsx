'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clipboard, Lock, Mail, Printer } from 'lucide-react';
import { useQuote, useStore } from '@/lib/store';
import { DEMO_MODE, book, oldestSourceDate } from '@/lib/book';
import { bps, bpsAsPct, dateLabel, int, money, moneyCompact, pct } from '@/lib/format';
import { buildEmail } from '@/lib/email';
import { Card, Chip, FindingList, SourceLink, Tile } from './ui/primitives';

export function DealOnAPage() {
  const { intake, setStep, reasonCategory, justification, today } = useStore();
  const quote = useQuote();
  const [copied, setCopied] = useState(false);

  const email = useMemo(
    () => buildEmail(intake, quote, book, reasonCategory, justification),
    [intake, quote, reasonCategory, justification],
  );
  const [draft, setDraft] = useState(email?.body ?? '');
  useEffect(() => setDraft(email?.body ?? ''), [email?.body]);

  const cur = intake.currency;
  const approval = quote.approval;
  const top = approval?.required ? approval.approvers.at(-1)?.name : null;

  function print() {
    const prev = document.title;
    const name = (intake.merchantName || 'Merchant').replace(/[^A-Za-z0-9]+/g, '');
    document.title = `DealOnAPage_${name}_${today}`;
    window.print();
    setTimeout(() => (document.title = prev), 500);
  }

  async function copy() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (quote.status !== 'OK' || quote.targetBps == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card title="No page to build">
          <div className="p-5">
            <p className="text-[0.875rem] leading-relaxed text-muted">
              This deal has no guidance take rate, so there is nothing to summarise. Route it to Strategic Pricing.
            </p>
            <button type="button" className="btn btn-ghost mt-4" onClick={() => setStep('recommendation')}>
              <ArrowLeft size={14} />
              Back
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      {/* ================= THE PAGE ================= */}
      <div className="print-root space-y-4">
        {/* 1 — Header */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <div className="chip-mono print-muted text-faint">Deal on a page</div>
              <h1 className="headline print-ink mt-1 text-3xl text-ink">{intake.merchantName || 'New merchant'}</h1>
              <p className="print-muted mt-2 text-[0.8125rem] leading-relaxed text-muted">
                {intake.merchantUrl && <>{intake.merchantUrl} · </>}
                MCC {intake.mcc || '—'} · {quote.match!.vertical} ·{' '}
                {intake.countryScope ? `${intake.region} (${intake.countryScope})` : intake.region} ·{' '}
                {intake.riskLevel === 'HIGH' ? 'High risk' : 'Standard risk'}
              </p>
              <p className="print-muted mt-1 text-[0.75rem] text-faint">
                {dateLabel(today)} · {intake.repName || 'unsigned'} · Cat {quote.band!.cat}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {DEMO_MODE && <Chip tone="purple">Demo data</Chip>}
              {intake.isGold && <Chip tone="lime">Gold</Chip>}
              <Chip tone={top === 'CEO' ? 'danger' : top === 'CRO' ? 'orange' : top ? 'blue' : 'lime'}>
                {top ?? 'No sign-off required'}
              </Chip>
            </div>
          </div>
        </Card>

        {/* 2 — Verdict */}
        <Card title="Verdict">
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Tile label="Guidance take rate" value={`${bps(quote.targetBps)}`} sub={bpsAsPct(quote.targetBps)} tone="lime" big />
            <Tile
              label="Requested"
              value={`${bps(quote.requestedBps)}`}
              sub={bpsAsPct(quote.requestedBps)}
              tone={(quote.discountPct ?? 0) > 0 ? 'orange' : 'lime'}
              big
            />
            <Tile
              label="Discount"
              value={pct(quote.discountPct)}
              tone={(quote.discountPct ?? 0) > 0 ? 'orange' : 'lime'}
              sub="vs guidance"
            />
            <Tile
              label="Annual revenue at risk"
              value={moneyCompact(quote.annualRevenueAtRisk, cur)}
              tone={(quote.annualRevenueAtRisk ?? 0) > 0 ? 'orange' : 'lime'}
              sub="vs quoting at guidance"
            />
          </div>
        </Card>

        {/* 3 — Money */}
        <Card title="Economics">
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-4">
            <Tile label="Merchant volume" value={moneyCompact(quote.effectiveMonthlyTpv, cur)} sub="per month" />
            <Tile
              label="To Checkout.com"
              value={moneyCompact(quote.billableMonthlyTpv, cur)}
              sub={`${intake.scopePct}% scope${intake.scopeNote ? ` · ${intake.scopeNote}` : ''}`}
            />
            <Tile
              label="Transactions"
              value={quote.monthlyTxns == null ? '—' : int(quote.monthlyTxns)}
              sub={`per month · ATV ${money(intake.atv, cur)}`}
            />
            <Tile label="eMNR monthly" value={money(quote.emnrMonthly, cur)} />
            <Tile label="eMNR annual" value={moneyCompact(quote.emnrAnnual, cur)} />
            <Tile
              label="Monthly Minimum Bill"
              value={intake.mmb ? money(intake.mmb, cur) : '—'}
              sub={quote.mmbImpliedFloorBps ? `implies ${bps(quote.mmbImpliedFloorBps)} bps` : undefined}
              tone={quote.mmbBinds ? 'orange' : 'neutral'}
            />
            <Tile label="Contract term" value={intake.contractTerm || '—'} />
            <Tile
              label="Cash incentives"
              value={intake.cashIncentivesUsd ? money(intake.cashIncentivesUsd, 'USD') : '—'}
            />
          </div>
        </Card>

        {/* 4 — Waterfall */}
        <Card title="How the guidance rate is built">
          <table className="w-full text-left text-[0.8125rem]">
            <thead>
              <tr className="chip-mono print-muted text-faint">
                <th className="px-5 py-2 font-medium">Component</th>
                <th className="px-3 py-2 font-medium">As quoted</th>
                <th className="px-3 py-2 text-right font-medium">bps</th>
                <th className="px-5 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.key} className="print-rule border-t border-line/60">
                  <td className="print-ink px-5 py-2 font-medium text-ink">{l.label}</td>
                  <td className="print-muted px-3 py-2 text-muted">{l.asQuoted}</td>
                  <td className="print-ink px-3 py-2 text-right tnum font-semibold text-ink">{bps(l.bps)}</td>
                  <td className="px-5 py-2">
                    <SourceLink sourceId={l.sourceId} locator={l.sourceLocator} verbatim={l.verbatim} today={today} />
                  </td>
                </tr>
              ))}
              <tr className="print-rule border-t-2 border-line-strong">
                <td className="print-ink px-5 py-2.5 font-semibold text-ink">Guidance total</td>
                <td className="print-muted px-3 py-2.5 tnum text-muted">{bpsAsPct(quote.targetBps)}</td>
                <td className="print-ink px-3 py-2.5 text-right tnum font-bold text-lime">{bps(quote.targetBps)}</td>
                <td className="px-5 py-2.5" />
              </tr>
              <tr className="print-rule border-t border-line/60">
                <td className="print-ink px-5 py-2.5 font-semibold text-ink">Requested</td>
                <td className="print-muted px-3 py-2.5 tnum text-muted">{bpsAsPct(quote.requestedBps)}</td>
                <td
                  className="print-ink px-3 py-2.5 text-right tnum font-bold"
                  style={{ color: (quote.discountPct ?? 0) > 0 ? 'var(--color-orange)' : 'var(--color-lime)' }}
                >
                  {bps(quote.requestedBps)}
                </td>
                <td className="px-5 py-2.5" />
              </tr>
            </tbody>
          </table>
        </Card>

        {/* 5 — Approvals */}
        <Card title="Approval path">
          <div className="p-5">
            {!approval?.required ? (
              <p className="print-ink text-[0.875rem] text-lime">
                No sign-off required — priced at or above the Acquirer Guidance take rate.
              </p>
            ) : (
              <>
                <p className="print-muted text-[0.75rem] text-muted">
                  {approval.track === 'gold' ? `Gold ladder — ${approval.goldReason}` : 'Non-Gold ladder'}
                  {approval.bandNote ? ` · ${approval.bandNote}` : ''}
                </p>
                <ol className="mt-3 flex flex-wrap items-center gap-2">
                  {approval.approvers.map((a, i) => (
                    <li key={a.name} className="flex items-center gap-2">
                      {i > 0 && <span className="print-muted text-faint">→</span>}
                      <span
                        className="print-card rounded-lg border px-2.5 py-1.5"
                        style={{
                          borderColor: a.name === 'CEO' ? 'var(--color-orange)' : 'var(--color-line-strong)',
                        }}
                      >
                        <span className="print-ink block text-[0.8125rem] font-semibold text-ink">{a.name}</span>
                        <span className="print-muted block text-[0.6875rem] text-muted">{a.reason}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {approval.managedBy && (
                  <p className="print-muted mt-3 text-[0.75rem] text-muted">Managed by {approval.managedBy}.</p>
                )}
                {approval.emailOwner === 'Strategic Pricing' && (
                  <p className="print-ink mt-2 text-[0.75rem] text-orange">
                    Above {book.approval_matrix.sp_routing_threshold_pct}% discount, Strategic Pricing owns the approval
                    email.
                  </p>
                )}
                {approval.qtcGate && (
                  <p className="print-ink mt-2 flex gap-2 text-[0.75rem] text-purple">
                    <Lock size={13} className="mt-0.5 shrink-0" />
                    Written approval from {approval.qtcGate.signatories.join(' or ')} required before QTC.
                  </p>
                )}
                {approval.sideTracks.map((t) => (
                  <p key={t.label} className="print-muted mt-2 text-[0.75rem] text-muted">
                    <strong className="print-ink text-ink">{t.label}</strong> — {t.approvers.join(', ')}
                  </p>
                ))}
              </>
            )}
          </div>
        </Card>

        {/* 6 — Justification */}
        {(reasonCategory || justification) && (
          <Card title="Rationale">
            <div className="p-5">
              {reasonCategory && <p className="print-ink text-[0.8125rem] font-semibold text-ink">{reasonCategory}</p>}
              {justification && (
                <p className="print-muted mt-1.5 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-muted">
                  {justification}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* 7 — Flags */}
        {quote.findings.some((f) => f.level === 'warning') && (
          <Card title="Flags">
            <div className="p-4">
              <FindingList findings={quote.findings} levels={['warning']} />
            </div>
          </Card>
        )}

        {/* 8 — Phase 2 stub */}
        <Card
          title="Peer pricing — Phase 2"
          right={<Chip tone="neutral">Not built</Chip>}
          className="print-omit opacity-60"
        >
          <div className="p-5">
            <p className="print-muted text-[0.8125rem] leading-relaxed text-muted">
              Phase 2 pulls live pricing for comparable merchants from CAT (
              <code className="font-mono text-[0.6875rem]">client-admin.cko-prod.ckotech.co/web/nas/</code>) so the
              guidance rate can be set against what similar accounts in this vertical and region actually pay. Needs VPN
              access and a data-access review — deliberately out of scope for this build.
            </p>
          </div>
        </Card>

        {/* 9 — Provenance footer */}
        <div className="print-rule flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-5 py-3 text-[0.6875rem]">
          <span className="print-muted text-faint">
            Pricing book <span className="tnum text-muted">{book.version}</span> ·{' '}
            {book.reviewed_by ? `approved by ${book.reviewed_by}` : 'NOT APPROVED'} · {book.sources.length} sources ·
            oldest document {dateLabel(oldestSourceDate())}
            {DEMO_MODE && ' · DEMO DATA — rates deliberately obfuscated'}
          </span>
          <span className="print-ink font-semibold text-orange">
            Internal — confidential pricing. Do not forward externally.
          </span>
        </div>
      </div>

      {/* ================= ACTIONS + EMAIL ================= */}
      <aside className="no-print space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary flex-1" onClick={print}>
            <Printer size={15} />
            Print / PDF
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setStep('challenge')}>
            <ArrowLeft size={14} />
            Rate
          </button>
        </div>

        {email ? (
          <Card title="Approval email" subtitle={email.routing}>
            <div className="space-y-3 p-4">
              <div>
                <span className="label">To</span>
                <p
                  className={`rounded-lg border px-3 py-2 text-[0.75rem] leading-snug ${
                    approval?.emailOwner === 'Strategic Pricing'
                      ? 'border-orange/50 bg-orange/[0.07] text-orange'
                      : 'border-line bg-sunken text-ink'
                  }`}
                >
                  {email.to}
                </p>
              </div>

              <div>
                <span className="label">Subject</span>
                <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-[0.75rem] leading-snug text-ink">
                  {email.subject}
                </p>
              </div>

              <div>
                <span className="label">Body — edit before you send</span>
                <textarea
                  className="field scroll-quiet h-[380px] resize-y whitespace-pre py-2 font-mono !text-[0.6875rem] leading-relaxed"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={copy}>
                  {copied ? <Check size={15} /> : <Clipboard size={15} />}
                  {copied ? 'Copied' : 'Copy email'}
                </button>
                <a
                  href={email.mailtoHref}
                  className={`btn btn-ghost ${email.mailtoSafe ? '' : 'pointer-events-none opacity-40'}`}
                  title={
                    email.mailtoSafe
                      ? 'Open in your mail client'
                      : 'Too long for a mailto: link — several clients would truncate it silently. Use Copy instead.'
                  }
                >
                  <Mail size={15} />
                  Mail
                </a>
              </div>

              <p className="text-[0.6875rem] leading-relaxed text-faint">
                The tool drafts, you send. Nothing is emailed automatically.
                {!email.mailtoSafe && ' This draft is too long for a mailto: link — use Copy.'}
              </p>
            </div>
          </Card>
        ) : (
          <Card title="Approval email">
            <p className="p-4 text-[0.8125rem] leading-relaxed text-muted">
              No approval email needed — this deal is priced at or above guidance.
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}
