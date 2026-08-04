'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { book } from '@/lib/book';
import { useStore } from '@/lib/store';
import { verticalForMcc, volumeDisagreement } from '@/lib/engine';
import { int, money, unitLabel } from '@/lib/format';
import demoMerchants from '../../data/demo-merchants.json' with { type: 'json' };
import { Card, Chip, Field, FindingRow, NumberInput, Select, TextInput, Toggle } from './ui/primitives';
import type { Currency, RiskLevel } from '@/lib/types';

const PLATFORMS = ['Shopify', 'Salesforce Commerce', 'Adobe Commerce / Magento', 'BigCommerce', 'Custom', 'Other'];

export function IntakeScreen() {
  const { intake, patch, setMcc, setVas, setStep, aiFilled, markAiFilled, loadDemo } = useStore();
  const [plainText, setPlainText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const mccHit = useMemo(() => (intake.mcc ? verticalForMcc(book, intake.mcc) : null), [intake.mcc]);
  const scopes = book.dimensions.country_scopes[intake.region] ?? [];
  const isAi = (f: string) => aiFilled.includes(f);

  const disagreement = volumeDisagreement(intake);
  const hasVolume = !!(intake.monthlyTpv || intake.threeMonthTpv || intake.annualTpv);
  const canContinue = hasVolume && !!intake.vertical && !!intake.region;

  const billable = useMemo(() => {
    const m = intake.monthlyTpv ?? (intake.threeMonthTpv ? intake.threeMonthTpv / 3 : intake.annualTpv ? intake.annualTpv / 12 : null);
    return m == null ? null : m * (intake.scopePct / 100);
  }, [intake.monthlyTpv, intake.threeMonthTpv, intake.annualTpv, intake.scopePct]);

  async function parsePlainEnglish() {
    setParsing(true);
    setParseError(null);
    try {
      const res = await fetch('/api/parse-merchant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: plainText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Parse failed');
      // The parser only ever fills intake fields. It never returns a rate.
      patch(json.fields);
      markAiFilled(Object.keys(json.fields));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {/* --- Plain English ------------------------------------------------ */}
        <Card
          title="Describe the merchant"
          subtitle="Paste what you know in plain English, or skip straight to the fields below."
          right={<Chip tone="purple">AI</Chip>}
        >
          <div className="space-y-3 p-4">
            <textarea
              className="field min-h-[72px] resize-y py-2 leading-relaxed"
              placeholder="UK fashion retailer on Shopify, about £4m a month, £65 average basket, currently with Adyen, wants 3DS and network tokens, 2 year term"
              value={plainText}
              onChange={(e) => setPlainText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={parsing || plainText.trim().length < 10}
                onClick={parsePlainEnglish}
              >
                <Wand2 size={14} />
                {parsing ? 'Reading…' : 'Fill the form'}
              </button>
              <span className="text-[0.6875rem] leading-snug text-faint">
                Fills merchant fields only — never a rate. Everything stays editable.
              </span>
            </div>
            {parseError && (
              <FindingRow
                finding={{
                  level: 'info',
                  code: 'PARSE_UNAVAILABLE',
                  message: 'AI parse unavailable — enter the fields manually.',
                  detail: parseError,
                }}
              />
            )}
          </div>
        </Card>

        {/* --- Merchant ----------------------------------------------------- */}
        <Card title="Merchant">
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Merchant name" className="sm:col-span-2 lg:col-span-1" aiFilled={isAi('merchantName')}>
              <TextInput
                value={intake.merchantName}
                onChange={(v) => patch({ merchantName: v })}
                placeholder="Acme Retail Ltd"
                aiFilled={isAi('merchantName')}
              />
            </Field>

            <Field label="Merchant URL" aiFilled={isAi('merchantUrl')}>
              <TextInput value={intake.merchantUrl} onChange={(v) => patch({ merchantUrl: v })} placeholder="acme.com" />
            </Field>

            <Field
              label="MCC"
              required
              aiFilled={isAi('mcc')}
              hint={
                intake.mcc
                  ? mccHit
                    ? `${mccHit.mcc} — ${mccHit.label} → ${mccHit.vertical}`
                    : 'Not in the MCC map. Pick a vertical by hand.'
                  : `${book.mcc_map.length} MCCs mapped to the framework's ${book.dimensions.verticals.length} verticals`
              }
            >
              <TextInput value={intake.mcc} onChange={setMcc} placeholder="5651" aiFilled={isAi('mcc')} />
            </Field>

            <Field
              label="Vertical"
              required
              aiFilled={isAi('vertical')}
              hint={intake.verticalOverridden ? 'Overridden by hand — MCC changes will not reset it' : undefined}
            >
              <Select
                value={intake.vertical}
                onChange={(v) => patch({ vertical: v, verticalOverridden: true })}
                placeholder="Select a vertical"
                options={book.dimensions.verticals.map((v) => ({ value: v, label: v }))}
                aiFilled={isAi('vertical')}
              />
            </Field>

            <Field label="Region / entity" required aiFilled={isAi('region')}>
              <Select
                value={intake.region}
                onChange={(v) => patch({ region: v, countryScope: null })}
                options={[
                  ...book.dimensions.regions.map((r) => ({ value: r, label: r })),
                  // Deliberately offered even though guidance does not cover it —
                  // the tool should be able to tell a rep "no guidance here".
                  { value: 'LATAM', label: 'LATAM (not in guidance)' },
                ]}
                aiFilled={isAi('region')}
              />
            </Field>

            <Field
              label="Country scope"
              hint={scopes.length ? 'The framework has more specific rows for these' : 'No country overrides in this region'}
            >
              <Select
                value={intake.countryScope ?? ''}
                onChange={(v) => patch({ countryScope: v === '' ? null : v })}
                placeholder={`${intake.region} — regional default`}
                options={scopes.map((s) => ({ value: s, label: s }))}
              />
            </Field>

            <Field
              label="Risk level"
              hint={intake.riskLevel === 'HIGH' ? 'High risk adds 15% to the standard take rate' : undefined}
            >
              <Select
                value={intake.riskLevel}
                onChange={(v) => patch({ riskLevel: v as RiskLevel })}
                options={[
                  { value: 'STD', label: 'Standard' },
                  { value: 'HIGH', label: 'High risk (+15%)' },
                ]}
              />
            </Field>

            <Field label="Platform" aiFilled={isAi('platform')}>
              <Select
                value={intake.platform}
                onChange={(v) => patch({ platform: v })}
                placeholder="Select"
                options={PLATFORMS.map((p) => ({ value: p, label: p }))}
                aiFilled={isAi('platform')}
              />
            </Field>

            <Field label="Current provider(s)" aiFilled={isAi('currentProviders')}>
              <TextInput
                value={intake.currentProviders}
                onChange={(v) => patch({ currentProviders: v })}
                placeholder="Adyen, Stripe"
                aiFilled={isAi('currentProviders')}
              />
            </Field>

            <Field label="Current acceptance rate">
              <NumberInput
                value={intake.currentAcceptanceRate}
                onChange={(v) => patch({ currentAcceptanceRate: v })}
                suffix="%"
                placeholder="87.4"
              />
            </Field>
          </div>
        </Card>

        {/* --- Volume ------------------------------------------------------- */}
        <Card
          title="Volume and deal shape"
          subtitle="Guidance bands on MONTHLY processing volume. Average transaction value drives per-transaction VAS pricing."
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Currency">
              <Select
                value={intake.currency}
                onChange={(v) => patch({ currency: v as Currency })}
                options={Object.keys(book.fx.rates).map((c) => ({ value: c as Currency, label: c }))}
              />
            </Field>

            <Field label="ATV" required aiFilled={isAi('atv')} hint="Average transaction value">
              <NumberInput
                value={intake.atv}
                onChange={(v) => patch({ atv: v })}
                prefix={intake.currency === 'GBP' ? '£' : intake.currency === 'EUR' ? '€' : '$'}
                placeholder="65"
                aiFilled={isAi('atv')}
              />
            </Field>

            <Field label="Monthly TPV" required aiFilled={isAi('monthlyTpv')} hint="Sets the guidance band">
              <NumberInput
                value={intake.monthlyTpv}
                onChange={(v) => patch({ monthlyTpv: v })}
                prefix={intake.currency === 'GBP' ? '£' : intake.currency === 'EUR' ? '€' : '$'}
                placeholder="4000000"
                aiFilled={isAi('monthlyTpv')}
              />
            </Field>

            <Field label="3-month TPV" hint="Cross-check only">
              <NumberInput value={intake.threeMonthTpv} onChange={(v) => patch({ threeMonthTpv: v })} placeholder="—" />
            </Field>

            <Field label="Annual TPV" aiFilled={isAi('annualTpv')} hint="Used if monthly is blank">
              <NumberInput
                value={intake.annualTpv}
                onChange={(v) => patch({ annualTpv: v })}
                placeholder="48000000"
                aiFilled={isAi('annualTpv')}
              />
            </Field>

            <Field
              label="Scope of volume"
              hint={
                billable != null
                  ? `${money(billable, intake.currency)}/month to Checkout.com`
                  : 'Share of volume Checkout.com will process'
              }
            >
              <NumberInput value={intake.scopePct} onChange={(v) => patch({ scopePct: v ?? 100 })} suffix="%" />
            </Field>

            <Field label="Scope note" className="sm:col-span-2">
              <TextInput
                value={intake.scopeNote}
                onChange={(v) => patch({ scopeNote: v })}
                placeholder="cards only, EU entity, phase 1"
              />
            </Field>

            <Field label="Contract term" aiFilled={isAi('contractTerm')}>
              <TextInput value={intake.contractTerm} onChange={(v) => patch({ contractTerm: v })} placeholder="2 years" />
            </Field>

            <Field label="Monthly Minimum Bill" hint="Implies a floor take rate">
              <NumberInput
                value={intake.mmb}
                onChange={(v) => patch({ mmb: v })}
                prefix={intake.currency === 'GBP' ? '£' : intake.currency === 'EUR' ? '€' : '$'}
                placeholder="—"
              />
            </Field>

            <Field label="Your name" hint="Signs the approval email">
              <TextInput value={intake.repName} onChange={(v) => patch({ repName: v })} placeholder="A. Manager" />
            </Field>
          </div>

          {disagreement && disagreement.spread > 0.15 && (
            <div className="px-4 pb-4">
              <FindingRow
                finding={{
                  level: 'warning',
                  code: 'VOLUME_DISAGREEMENT',
                  message: `Volume figures disagree by ${Math.round(disagreement.spread * 100)}% once annualized.`,
                  detail: disagreement.annualized
                    .map((a) => `${a.label}: ${money(a.value, intake.currency)}`)
                    .join('   ·   '),
                }}
              />
            </div>
          )}
        </Card>

        {/* --- Deal shape that changes the approval ladder ------------------- */}
        <Card
          title="Approval-relevant terms"
          subtitle="Gold status, cash incentives and free processing each route differently, whatever the take rate is."
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
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

        {/* --- VAS ---------------------------------------------------------- */}
        <Card
          title="Value-added services"
          subtitle="Guidance already carries expected VAS revenue in its Other line. These toggles drive the attach check, not the target rate."
          right={<Chip tone="orange">List prices unverified</Chip>}
        >
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {book.vas_catalogue.map((v) => {
              const sel = intake.vas[v.key] ?? { enabled: false, attachRate: v.default_attach_rate };
              const perRequest = v.unit === 'per_request';
              return (
                <div key={v.key} className="space-y-2">
                  <Toggle
                    checked={sel.enabled}
                    onChange={(on) => setVas(v.key, { enabled: on })}
                    label={v.label}
                    hint={unitLabel(v.unit, v.amount, v.currency)}
                  />
                  {sel.enabled && perRequest && (
                    <div className="rounded-lg border border-line bg-sunken px-3 py-2.5">
                      <div className="flex items-baseline justify-between">
                        <span className="label !mb-0">Attach rate</span>
                        <span className="tnum text-[0.8125rem] font-semibold text-blue-bright">
                          {Math.round(sel.attachRate * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(sel.attachRate * 100)}
                        onChange={(e) => setVas(v.key, { attachRate: Number(e.target.value) / 100 })}
                        className="mt-1"
                      />
                      <p className="mt-0.5 text-[0.6875rem] leading-snug text-faint">{v.attach_rate_note}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* --- Right rail ----------------------------------------------------- */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card title="Demo merchants" subtitle="Seeded deals with known answers.">
          <div className="space-y-2 p-3">
            {demoMerchants.merchants.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => loadDemo(m.intake as never)}
                className="w-full rounded-lg border border-line bg-sunken px-3 py-2.5 text-left transition-colors hover:border-blue-bright"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.8125rem] font-medium text-ink">{m.label}</span>
                  {m.expect && <Chip tone={m.expect === 'UNMAPPED' ? 'orange' : 'lime'}>{m.expect}</Chip>}
                </div>
                <p className="mt-0.5 text-[0.6875rem] leading-snug text-faint">{m.note}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card title="What happens next">
          <ol className="space-y-2.5 p-4 text-[0.8125rem] leading-relaxed text-muted">
            <li>
              <strong className="text-ink">Guidance take rate</strong> — matched to your region, vertical and monthly
              band, decomposed line by line with a link to the source for each.
            </li>
            <li>
              <strong className="text-ink">Accept or challenge</strong> — move the rate and watch the discount, the
              revenue at risk and the approval chain move with it.
            </li>
            <li>
              <strong className="text-ink">Deal on a page</strong> — one printable page plus a drafted approval email.
            </li>
          </ol>
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={!canContinue}
              onClick={() => setStep('recommendation')}
            >
              <Sparkles size={14} />
              Build the price
              <ArrowRight size={14} />
            </button>
            {!canContinue && (
              <p className="mt-2 text-[0.6875rem] leading-snug text-faint">
                Needs a vertical, a region and one volume figure.
              </p>
            )}
            {canContinue && intake.atv == null && (
              <p className="mt-2 text-[0.6875rem] leading-snug text-orange">
                No ATV — the guidance rate still works, but per-transaction VAS pricing will not.
              </p>
            )}
          </div>
        </Card>

        <Card title="Coverage">
          <dl className="space-y-1.5 p-4 text-[0.75rem]">
            <Row k="Framework rows" v={int(book.acquiring.length)} />
            <Row k="Regions" v={book.dimensions.regions.join(', ')} />
            <Row k="Verticals" v={String(book.dimensions.verticals.length)} />
            <Row k="Volume bands" v={`${book.monthly_tpv_bands_musd.length} · from $1m/month`} />
            <Row k="Book version" v={book.version} />
          </dl>
        </Card>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-faint">{k}</dt>
      <dd className="tnum text-right text-muted">{v}</dd>
    </div>
  );
}
