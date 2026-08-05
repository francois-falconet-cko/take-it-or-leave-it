'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clipboard, Send, ShieldCheck } from 'lucide-react';
import { useQuote, useStore } from '@/lib/store';
import { buildApprovalEmail } from '@/lib/email';
import { bps, bpsAsPct, moneyCompact, pct } from '@/lib/format';
import { Card, Chip, Field, FindingList, NumberInput, Tile, Toggle } from './ui/primitives';

/**
 * The approval path.
 *
 * Driven entirely by the Sales Rep Adjusted Take Rate — the rate the rep built on
 * the previous page. There is no rate to choose here and no "accept or challenge"
 * fork: the discount is whatever the built rate implies against guidance, and the
 * ladder follows from that. The only inputs are the two terms that change the
 * routing rather than the price: Gold status and cash incentives.
 */
export function ApprovalPathScreen() {
  const { intake, patch, setStep } = useStore();
  const quote = useQuote();

  if (quote.status !== 'OK' || quote.targetBps == null || quote.adjusted?.totalBps == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card title="Price the deal first">
          <div className="p-5">
            <p className="text-[0.875rem] leading-relaxed text-muted">
              There is no Sales Rep Adjusted Take Rate yet. Go back, build the price, then price core acquiring or a
              value-added service.
            </p>
            <button type="button" className="btn btn-ghost mt-4" onClick={() => setStep('intake')}>
              <ArrowLeft size={14} />
              Back to pricing
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const adjustedBps = quote.adjusted.totalBps;
  const discount = quote.discountPct ?? 0;
  const approval = quote.approval;
  const needsApproval = !!approval?.required;
  const cur = intake.currency;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* 1 — The three numbers the approver asks for, and the verdict. */}
      <Card>
        <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <RateCell
            label="Recommended take rate"
            value={quote.targetBps}
            tone="lime"
            note={`Acquirer Guidance · Cat ${quote.band!.cat}`}
          />
          <RateCell
            label="Sales rep adjusted take rate"
            value={adjustedBps}
            tone="blue"
            note={`Core ${bps(quote.adjusted.coreAcquiringBps)} + VAS ${bps(quote.adjusted.vasBps)}`}
          />
          <div className="p-5">
            <div className="chip-mono text-faint">Discount vs recommended</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={`font-display text-4xl font-bold leading-none tnum ${
                  discount > 0 ? 'text-orange' : 'text-lime'
                }`}
              >
                {discount > 0 ? pct(discount) : '0%'}
              </span>
            </div>
            <p className="mt-2 text-[0.75rem] leading-snug text-faint">
              {discount > 0
                ? `${bps(quote.targetBps - adjustedBps)} bps below guidance`
                : 'At or above the guidance take rate'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-3.5">
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            {intake.merchantName || 'This merchant'} · {quote.match!.vertical} · {quote.match!.region} ·{' '}
            {moneyCompact(quote.billableMonthlyTpv, cur)}/month
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip tone={intake.isGold ? 'lime' : 'neutral'}>{intake.isGold ? 'Gold' : 'Non-Gold'}</Chip>
            {approval?.track === 'gold' && !intake.isGold && <Chip tone="lime">Gold track — over $1bn</Chip>}
            {intake.riskLevel === 'HIGH' && <Chip tone="orange">High risk</Chip>}
          </div>
        </div>
      </Card>

      {/* 2 — The verdict, stated plainly. */}
      {needsApproval ? <ApprovalRequired /> : <NoApprovalRequired />}

      {/* 3 — The two terms that change routing without changing the price. */}
      <Card
        title="Deal terms that change the routing"
        subtitle="Neither of these moves the take rate. Both can move who has to sign it."
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle
              checked={intake.isGold}
              onChange={(v) => patch({ isGold: v })}
              label="Gold account"
              hint="Gold deals route through Paul Goodwin, and need sign-off even at guidance"
              accent="var(--color-lime)"
            />
          </div>

          <Field label="Cash incentives" hint="Above $500k reaches the CEO on a Gold deal">
            <NumberInput
              value={intake.cashIncentivesUsd}
              onChange={(v) => patch({ cashIncentivesUsd: v })}
              prefix="$"
              placeholder="—"
            />
          </Field>

          <Field label="Free processing / VAS trial" hint="Months. 4+ needs the CRO, on its own ladder">
            <NumberInput
              value={intake.freeProcessingMonths}
              onChange={(v) => patch({ freeProcessingMonths: v })}
              suffix="mo"
              placeholder="—"
            />
          </Field>
        </div>
      </Card>

      {/* 4 — Economics, for the approver's benefit. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="eMNR monthly" value={moneyCompact(quote.emnrMonthly, cur)} sub="at the adjusted rate" />
        <Tile label="eMNR annual" value={moneyCompact(quote.emnrAnnual, cur)} sub="net revenue" />
        <Tile
          label="Annual revenue at risk"
          value={moneyCompact(quote.annualRevenueAtRisk, cur)}
          tone={(quote.annualRevenueAtRisk ?? 0) > 0 ? 'orange' : 'lime'}
          sub="vs quoting at guidance"
        />
      </div>

      {needsApproval && <EmailComposer />}

      <FindingList findings={quote.findings} levels={['warning']} />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="button" className="btn btn-ghost" onClick={() => setStep('intake')}>
          <ArrowLeft size={14} />
          Back to pricing
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep('deal')}>
          Deal on a page
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function RateCell({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: number | null;
  tone: 'lime' | 'blue';
  note: string;
}) {
  return (
    <div className="p-5">
      <div className="chip-mono text-faint">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={`font-display text-4xl font-bold leading-none tnum ${
            tone === 'lime' ? 'text-lime' : 'text-blue-bright'
          }`}
        >
          {bps(value)}
        </span>
        <span className="font-display text-base font-bold leading-none text-muted">bps</span>
        <span className="tnum text-[0.8125rem] text-muted">{bpsAsPct(value)}</span>
      </div>
      <p className="mt-2 text-[0.75rem] leading-snug text-faint">{note}</p>
    </div>
  );
}

/** Priced at or above guidance, non-Gold: nothing to approve. */
function NoApprovalRequired() {
  return (
    <Card>
      <div className="flex items-start gap-4 p-5">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-lime/15">
          <ShieldCheck size={20} className="text-lime" />
        </span>
        <div>
          <h2 className="headline text-2xl text-lime">No approval required</h2>
          <p className="mt-2 max-w-xl text-[0.875rem] leading-relaxed text-muted">
            The Sales Rep Adjusted Take Rate is at or above the Acquirer Guidance recommendation, so there is no
            discount to approve. Take the deal.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Who signs, in seniority order, and who receives the email. */
function ApprovalRequired() {
  const intake = useStore((s) => s.intake);
  const quote = useQuote();
  const a = quote.approval!;
  const email = useMemo(() => buildApprovalEmail(intake, quote), [intake, quote]);

  return (
    <Card
      title="Approval path"
      subtitle="Determined by the discount on the Sales Rep Adjusted Take Rate."
      right={<Chip tone={a.track === 'gold' ? 'lime' : 'blue'}>{a.track === 'gold' ? 'Gold ladder' : 'Non-Gold ladder'}</Chip>}
    >
      <ol className="divide-y divide-line/60">
        {a.approvers.map((ap, i) => (
          <li key={ap.name} className="flex items-start gap-3 px-5 py-3">
            <span className="chip-mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-high text-muted">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[0.875rem] font-semibold text-ink">{ap.name}</p>
              <p className="mt-0.5 text-[0.75rem] leading-snug text-muted">{ap.reason}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2">
        <div>
          <div className="chip-mono text-faint">Send to</div>
          <p className="mt-1 text-[0.875rem] font-semibold text-ink">{email?.recipient.name ?? '—'}</p>
          <p className="text-[0.75rem] text-muted">{email?.recipient.email ?? '—'}</p>
        </div>
        <div>
          <div className="chip-mono text-faint">Why</div>
          <p className="mt-1 text-[0.8125rem] leading-snug text-muted">{email?.recipient.why ?? '—'}</p>
        </div>
      </div>

      {a.qtcGate && (
        <p className="border-t border-orange/30 bg-orange/[0.06] px-5 py-3 text-[0.75rem] leading-relaxed text-orange">
          {a.qtcGate.text}
        </p>
      )}

      {a.sideTracks.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <div className="chip-mono text-faint">Separate approvals</div>
          <ul className="mt-1.5 space-y-1">
            {a.sideTracks.map((t) => (
              <li key={t.label} className="text-[0.8125rem] leading-snug text-muted">
                <span className="text-ink">{t.label}</span> — {t.approvers.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/**
 * The draft.
 *
 * Recipient, subject and the three figures are filled in; the reasons are left as
 * empty bullets for the rep to complete. Re-seeded whenever the numbers move, so a
 * draft can never quote a rate the deal no longer carries — which does mean an
 * edit is lost if the price changes underneath it.
 */
function EmailComposer() {
  const intake = useStore((s) => s.intake);
  const quote = useQuote();
  const draft = useMemo(() => buildApprovalEmail(intake, quote), [intake, quote]);

  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [copied, setCopied] = useState(false);

  useEffect(() => setSubject(draft?.subject ?? ''), [draft?.subject]);
  useEffect(() => setBody(draft?.body ?? ''), [draft?.body]);

  if (!draft) return null;

  async function copy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card
      title="Approval email"
      subtitle="Everything is editable. Nothing sends until you say so."
      right={<Chip tone="purple">Draft</Chip>}
    >
      <div className="space-y-3 p-4">
        <Field label="To">
          <input className="field" value={draft.recipient.email} readOnly />
        </Field>

        <Field label="Subject">
          <input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>

        <Field label="Message">
          <textarea
            className="field scroll-quiet min-h-[340px] resize-y py-2 font-mono text-[0.75rem] leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          {/*
            Placeholder. There is no mail transport wired up, and a Send button that
            silently does nothing is worse than one that says so — hence the note
            beside it rather than a toast that implies delivery.
          */}
          <button type="button" className="btn btn-primary" onClick={() => undefined}>
            <Send size={14} />
            Send
          </button>
          <button type="button" className="btn btn-ghost" onClick={copy}>
            {copied ? <Check size={14} /> : <Clipboard size={14} />}
            {copied ? 'Copied' : 'Copy message'}
          </button>
          <span className="text-[0.75rem] text-faint">
            Send is not wired to a mailbox yet — copy the message and send it from your mail client.
          </span>
        </div>
      </div>
    </Card>
  );
}
