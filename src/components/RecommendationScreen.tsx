'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useQuote, useStore } from '@/lib/store';
import { bps, bpsAsPct, moneyCompact } from '@/lib/format';
import { Card, Chip, Field, NumberInput, Select, Tile, Toggle } from './ui/primitives';

/**
 * Second page: approval-relevant deal terms, then accept or challenge.
 * The guidance take rate was already shown on the merchant page.
 */
export function RecommendationScreen() {
  const { intake, patch, setStep, setRequestedBps } = useStore();
  const quote = useQuote();

  if (quote.status !== 'OK' || quote.targetBps == null) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card title="Build a price first">
          <div className="p-5">
            <p className="text-[0.875rem] leading-relaxed text-muted">
              There is no guidance take rate yet. Go back to the merchant page, fill volume, and click Build the price.
            </p>
            <button type="button" className="btn btn-ghost mt-4" onClick={() => setStep('intake')}>
              <ArrowLeft size={14} />
              Back to merchant
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const cur = intake.currency;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4 p-5">
          <div>
            <div className="chip-mono text-faint">Guidance take rate</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tnum text-lime">{bps(quote.targetBps)}</span>
              <span className="text-lg text-muted">bps</span>
              <span className="tnum text-muted">{bpsAsPct(quote.targetBps)}</span>
            </div>
            <p className="mt-1.5 text-[0.8125rem] text-muted">
              {intake.merchantName || 'This merchant'}
              {quote.band ? ` · Cat ${quote.band.cat}` : ''}
              {quote.billableMonthlyTpv != null ? ` · ${moneyCompact(quote.billableMonthlyTpv, cur)}/mo` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {intake.riskLevel === 'HIGH' && <Chip tone="orange">High risk</Chip>}
            {intake.isGold && <Chip tone="lime">Gold</Chip>}
          </div>
        </div>
      </Card>

      <Card
        title="Approval-relevant terms"
        subtitle="Gold status, cash incentives and free processing each route differently, whatever the take rate is."
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Toggle
              checked={intake.isGold}
              onChange={(v) => patch({ isGold: v })}
              label="Gold account"
              hint="Gold deals need Team Leader + Strategic Pricing even at guidance"
              accent="var(--color-lime)"
            />
          </div>

          <Field label="Cash incentives" hint="Above $500k reaches the CEO on Gold">
            <NumberInput
              value={intake.cashIncentivesUsd}
              onChange={(v) => patch({ cashIncentivesUsd: v })}
              prefix="$"
              placeholder="—"
            />
          </Field>

          <Field label="Free processing / VAS trial" hint="Months. 4+ needs the CRO">
            <NumberInput
              value={intake.freeProcessingMonths}
              onChange={(v) => patch({ freeProcessingMonths: v })}
              suffix="mo"
              placeholder="—"
            />
          </Field>

          <Field
            label="Strategic Pricing exception"
            className="sm:col-span-2"
            hint="Cases Strategic Pricing can approve on behalf of the CRO"
          >
            <Select
              value={intake.spException}
              onChange={(v) => patch({ spException: v as typeof intake.spException })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'new_entity_only', label: 'Adding an entity to an approved merchant, no pricing change' },
                { value: 'minor_adjustment_le_5pct', label: 'Adjustment of 5% or less to CRO-approved pricing' },
              ]}
            />
          </Field>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile
          label="eMNR at guidance"
          value={moneyCompact((quote.billableMonthlyTpv ?? 0) * (quote.targetBps / 10_000), cur)}
          sub="per month"
        />
        <Tile
          label="Annualized"
          value={moneyCompact((quote.billableMonthlyTpv ?? 0) * (quote.targetBps / 10_000) * 12, cur)}
          sub="net revenue"
        />
        <Tile label="Volume band" value={quote.band ? `Cat ${quote.band.cat}` : '—'} sub={quote.match?.vertical} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={() => {
            setRequestedBps(quote.targetBps);
            setStep('deal');
          }}
        >
          <Check size={15} />
          Accept {bps(quote.targetBps)} bps
        </button>
        <button type="button" className="btn btn-ghost flex-1" onClick={() => setStep('challenge')}>
          Challenge the rate
          <ArrowRight size={14} />
        </button>
      </div>

      <button
        type="button"
        className="btn btn-ghost !border-transparent !text-muted"
        onClick={() => setStep('intake')}
      >
        <ArrowLeft size={14} />
        Back to merchant
      </button>
    </div>
  );
}
