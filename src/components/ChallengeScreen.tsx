'use client';

import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, FileCheck2, Lock, ShieldCheck } from 'lucide-react';
import { useQuote, useStore } from '@/lib/store';
import { book } from '@/lib/book';
import { bps, bpsAsPct, moneyCompact, pct } from '@/lib/format';
import { REASON_FALLBACK } from '@/lib/store';
import type { ApprovalOutcome } from '@/lib/types';
import { Card, Chip, Field, FindingList, NumberInput, Select, Tile } from './ui/primitives';

/** Escalation reads as colour: at guidance is lime, the CEO is orange. */
function severityColor(top: string | null): string {
  switch (top) {
    case 'CEO':
      return 'var(--color-orange)';
    case 'CRO':
      return '#e8c33a';
    case 'Regional Leader':
    case 'Regional Revenue Leader':
      return 'var(--color-blue-bright)';
    case 'Team Leader':
    case 'Strategic Pricing':
      return 'var(--color-purple)';
    default:
      return 'var(--color-lime)';
  }
}

function topOf(a: ApprovalOutcome | null): string | null {
  if (!a || !a.required || a.approvers.length === 0) return null;
  return a.approvers.at(-1)!.name;
}

export function ChallengeScreen() {
  const { intake, setStep, requestedBps, setRequestedBps, reasonCategory, justification, setReason } = useStore();
  const quote = useQuote();

  const target = quote.targetBps;
  const cur = intake.currency;

  // Arriving here from "Challenge the rate" leaves requestedBps unset, which would
  // show the guidance rate in the headline but empty money tiles beside it. Seed it
  // so the screen opens at guidance with every figure already live.
  useEffect(() => {
    if (requestedBps == null && target != null) setRequestedBps(target);
  }, [requestedBps, target, setRequestedBps]);

  // Slider spans a 60% discount to a 20% premium — the guidance's own ceiling is
  // "over 50%", so the range has to reach past it for the CEO band to be visible.
  const range = useMemo(() => {
    if (target == null) return { min: 1, max: 100 };
    return { min: Math.max(1, Math.round(target * 0.4 * 10) / 10), max: Math.round(target * 1.2 * 10) / 10 };
  }, [target]);

  if (target == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card title="Nothing to challenge">
          <div className="p-5">
            <p className="text-[0.875rem] leading-relaxed text-muted">
              There is no guidance take rate for this merchant, so there is no discount to request. Route the deal to
              Strategic Pricing instead.
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

  const current = requestedBps ?? target;
  const approval = quote.approval;
  const top = topOf(approval);
  const accent = severityColor(top);
  const discount = quote.discountPct ?? 0;
  const spOwns = approval?.emailOwner === 'Strategic Pricing';
  const canContinue = current > 0 && (discount <= 0 || (reasonCategory !== '' && justification.trim().length >= 40));

  const reasons = book.approval_matrix.discount_bands ? REASON_FALLBACK : REASON_FALLBACK;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        {/* --- The slider --------------------------------------------------- */}
        <Card title="Requested take rate">
          <div className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-display text-6xl font-bold leading-none tnum transition-colors duration-300"
                    style={{ color: accent }}
                  >
                    {bps(current)}
                  </span>
                  <span className="font-display text-2xl font-bold leading-none text-muted">bps</span>
                  <span className="tnum text-lg text-muted">{bpsAsPct(current)}</span>
                </div>
                <p className="mt-2 text-[0.8125rem] text-muted">
                  Guidance is <span className="tnum font-semibold text-lime">{bps(target)} bps</span>
                  {discount > 0 ? (
                    <>
                      {' '}
                      — you are asking for a{' '}
                      <span className="tnum font-semibold" style={{ color: accent }}>
                        {pct(discount)} discount
                      </span>
                    </>
                  ) : discount < 0 ? (
                    <>
                      {' '}
                      — you are pricing{' '}
                      <span className="tnum font-semibold text-lime">{pct(-discount)} above</span> it
                    </>
                  ) : (
                    ' — you are in line with it'
                  )}
                </p>
              </div>

              <div className="w-32">
                <Field label="Exact bps">
                  <NumberInput value={current} onChange={(v) => setRequestedBps(v ?? target)} suffix="bps" />
                </Field>
              </div>
            </div>

            <div className="mt-5">
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={0.1}
                value={current}
                onChange={(e) => setRequestedBps(Number(e.target.value))}
                style={
                  {
                    '--thumb': accent,
                    '--track': `linear-gradient(to right, var(--color-orange) 0%, #e8c33a 25%, var(--color-blue-bright) 45%, var(--color-lime) ${((target - range.min) / (range.max - range.min)) * 100}%, var(--color-high) ${((target - range.min) / (range.max - range.min)) * 100}%)`,
                  } as React.CSSProperties
                }
              />
              <div className="mt-1 flex justify-between text-[0.6875rem] tnum text-faint">
                <span>{bps(range.min)} bps · 60% discount</span>
                <button
                  type="button"
                  className="text-lime underline decoration-lime/40 underline-offset-2 hover:decoration-lime"
                  onClick={() => setRequestedBps(target)}
                >
                  guidance {bps(target)}
                </button>
                <span>{bps(range.max)} bps</span>
              </div>
            </div>
          </div>

          {/* --- Live money ---------------------------------------------- */}
          <div className="grid grid-cols-2 gap-5 border-t border-line px-5 py-4 sm:grid-cols-4">
            <Tile label="Discount vs guidance" value={pct(discount)} tone={discount > 0 ? 'orange' : 'lime'} />
            <Tile
              label="Annual revenue at risk"
              value={moneyCompact(quote.annualRevenueAtRisk, cur)}
              tone={(quote.annualRevenueAtRisk ?? 0) > 0 ? 'orange' : 'lime'}
              big
              sub="vs quoting at guidance"
            />
            <Tile label="eMNR monthly" value={moneyCompact(quote.emnrMonthly, cur)} />
            <Tile label="eMNR annual" value={moneyCompact(quote.emnrAnnual, cur)} />
          </div>
        </Card>

        <FindingList findings={quote.findings} levels={['blocking', 'warning']} />

        {/* --- Justification ---------------------------------------------- */}
        {discount > 0 && (
          <Card title="Why" subtitle="This goes into the approval email verbatim, so write it for the approver.">
            <div className="space-y-4 p-4">
              <Field label="Reason category" required>
                <Select
                  value={reasonCategory}
                  onChange={(v) => setReason(v, justification)}
                  placeholder="Select a reason"
                  options={reasons.map((r) => ({ value: r, label: r }))}
                />
              </Field>
              <Field
                label="Justification"
                required
                hint={`${justification.trim().length} / 40 characters minimum`}
              >
                <textarea
                  className="field min-h-[96px] resize-y py-2 leading-relaxed"
                  data-invalid={justification.length > 0 && justification.trim().length < 40 ? 'true' : undefined}
                  value={justification}
                  onChange={(e) => setReason(reasonCategory, e.target.value)}
                  placeholder="Incumbent has offered 32 bps on a 3-year term. Merchant is a reference account in the UK apparel segment and has committed to migrate 100% of card volume in phase 2."
                />
              </Field>
            </div>
          </Card>
        )}
      </div>

      {/* --- Approval chain ---------------------------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card
          title="Approval path"
          subtitle={approval?.track === 'gold' ? `Gold ladder — ${approval.goldReason}` : 'Non-Gold ladder'}
          right={
            <Chip tone={top === 'CEO' ? 'danger' : top === 'CRO' ? 'orange' : top ? 'blue' : 'lime'}>
              {top ?? 'No sign-off'}
            </Chip>
          }
        >
          <div className="p-4">
            {!approval?.required ? (
              <div className="flex items-start gap-3 rounded-lg border border-lime/40 bg-lime/[0.07] px-3 py-3">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-lime" />
                <div>
                  <p className="text-[0.8125rem] font-medium text-lime">No sign-off required</p>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">
                    {approval?.notes[0] ?? 'At or above the Acquirer Guidance take rate.'}
                  </p>
                </div>
              </div>
            ) : (
              <ol className="space-y-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {approval.approvers.map((a, i) => (
                    <motion.li
                      key={a.name}
                      layout
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
                      style={{
                        borderColor:
                          a.name === 'CEO'
                            ? 'var(--color-orange)'
                            : a.name === 'CRO'
                              ? '#e8c33a'
                              : 'var(--color-line-strong)',
                        background: a.name === 'CEO' ? 'rgba(255,79,24,0.09)' : 'var(--color-sunken)',
                      }}
                    >
                      <span className="chip-mono mt-0.5 w-4 shrink-0 text-faint">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-[0.875rem] font-semibold text-ink">{a.name}</span>
                        <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted">{a.reason}</span>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}

            {approval?.managedBy && (
              <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted">
                Managed by <strong className="text-ink">{approval.managedBy}</strong>.
              </p>
            )}
          </div>

          {spOwns && (
            <div className="border-t border-orange/30 bg-orange/[0.07] px-4 py-3">
              <p className="flex gap-2 text-[0.75rem] leading-relaxed text-orange">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Above {book.approval_matrix.sp_routing_threshold_pct}% discount you do not send the approval email —{' '}
                  <strong>Strategic Pricing</strong> does. The draft is addressed to them.
                </span>
              </p>
            </div>
          )}

          {approval?.qtcGate && (
            <div className="border-t border-line bg-sunken px-4 py-3">
              <p className="flex gap-2 text-[0.75rem] leading-relaxed text-muted">
                <Lock size={14} className="mt-0.5 shrink-0 text-purple" />
                <span>
                  <strong className="text-ink">QTC gate.</strong> Written approval from{' '}
                  {approval.qtcGate.signatories.join(' or ')} must be in place before anything is actioned in QTC. No
                  exceptions.
                </span>
              </p>
            </div>
          )}

          {approval?.sideTracks.map((t) => (
            <div key={t.label} className="border-t border-line px-4 py-3">
              <p className="text-[0.75rem] font-medium text-ink">{t.label}</p>
              <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
                {t.approvers.join(', ')} — {t.note}
              </p>
            </div>
          ))}

          {approval?.spExceptionApplied && (
            <div className="border-t border-line px-4 py-3">
              <p className="text-[0.6875rem] leading-relaxed text-purple">
                Exception applied: {approval.spExceptionApplied}
              </p>
            </div>
          )}
        </Card>

        {approval && approval.notes.length > 0 && (
          <Card title="Interpretation notes">
            <ul className="space-y-2 p-4">
              {approval.notes.map((n, i) => (
                <li key={i} className="text-[0.6875rem] leading-relaxed text-faint">
                  {n}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={!canContinue}
            onClick={() => setStep('deal')}
          >
            <FileCheck2 size={15} />
            Deal on a page
            <ArrowRight size={14} />
          </button>
          {!canContinue && discount > 0 && (
            <p className="text-[0.6875rem] leading-snug text-faint">
              Pick a reason and write at least 40 characters of justification.
            </p>
          )}
          <button
            type="button"
            className="btn btn-ghost w-full !border-transparent !text-muted"
            onClick={() => setStep('recommendation')}
          >
            <ArrowLeft size={14} />
            Back to guidance
          </button>
        </div>
      </aside>
    </div>
  );
}
