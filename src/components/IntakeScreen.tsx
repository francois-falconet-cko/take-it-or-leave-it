'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { book } from '@/lib/book';
import { useQuote, useStore } from '@/lib/store';
import { verticalForMcc } from '@/lib/engine';
import { int, unitLabel } from '@/lib/format';
import demoMerchants from '../../data/demo-merchants.json' with { type: 'json' };
import { autofillFieldKeys, lookupUrlAutofill } from '@/lib/urlAutofill';
import { GuidanceQuotePanel } from './GuidanceQuotePanel';
import { Card, Chip, Field, FindingRow, NumberInput, Select, TextInput, Toggle } from './ui/primitives';
import type { Currency, RiskLevel } from '@/lib/types';

export function IntakeScreen() {
  const { intake, patch, setMcc, setVas, setStep, aiFilled, markAiFilled, loadDemo } = useStore();
  const quote = useQuote();
  const [plainText, setPlainText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [urlAutofillId, setUrlAutofillId] = useState<string | null>(null);
  const [priceBuilt, setPriceBuilt] = useState(false);
  const quoteRef = useRef<HTMLDivElement>(null);

  function onMerchantUrlChange(raw: string) {
    patch({ merchantUrl: raw });
    const hit = lookupUrlAutofill(raw);
    if (!hit) {
      setUrlAutofillId(null);
      return;
    }
    if (hit.id === urlAutofillId) return;
    patch({ merchantUrl: raw, ...hit.fields });
    markAiFilled(autofillFieldKeys(hit.fields));
    setUrlAutofillId(hit.id);
  }

  const mccHit = useMemo(() => (intake.mcc ? verticalForMcc(book, intake.mcc) : null), [intake.mcc]);
  const isAi = (f: string) => aiFilled.includes(f);

  const hasVolume = !!(intake.monthlyTpv || intake.threeMonthTpv || intake.annualTpv);
  const canBuild = hasVolume && !!intake.vertical && !!intake.region;
  const canContinueToTerms = priceBuilt && quote.status === 'OK';

  function buildPrice() {
    if (!canBuild) return;
    setPriceBuilt(true);
  }

  useEffect(() => {
    if (!priceBuilt) return;
    quoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [priceBuilt]);

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
        <Card
          title="Describe the merchant"
          subtitle="Paste what you know in plain English, or skip straight to the fields below."
          right={<Chip tone="purple">AI</Chip>}
        >
          <div className="space-y-3 p-4">
            <textarea
              className="field min-h-[72px] resize-y py-2 leading-relaxed"
              placeholder="UK fashion retailer on Shopify, about £4m a month, £65 average basket"
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

            <Field
              label="Merchant URL"
              aiFilled={isAi('merchantUrl')}
              hint={
                urlAutofillId
                  ? 'Known demo URL — merchant fields filled from the static profile.'
                  : 'Paste a demo host (e.g. rebelliousfashion.com) to auto-fill merchant fields.'
              }
            >
              <TextInput
                value={intake.merchantUrl}
                onChange={onMerchantUrlChange}
                placeholder="rebelliousfashion.com"
                aiFilled={!!urlAutofillId}
              />
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
                  { value: 'LATAM', label: 'LATAM (not in guidance)' },
                ]}
                aiFilled={isAi('region')}
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
          </div>
        </Card>

        <Card
          title="Volume"
          subtitle="Guidance bands on monthly processing volume. Average transaction value drives per-transaction VAS pricing."
        >
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>

          <div className="border-t border-line px-4 py-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canBuild}
              onClick={buildPrice}
            >
              <Sparkles size={14} />
              Build the price
            </button>
            {!canBuild && (
              <p className="mt-2 text-[0.6875rem] leading-snug text-faint">
                Needs a vertical, a region and monthly TPV.
              </p>
            )}
            {canBuild && intake.atv == null && (
              <p className="mt-2 text-[0.6875rem] leading-snug text-orange">
                No ATV — the guidance rate still works, but per-transaction VAS pricing will not.
              </p>
            )}
          </div>
        </Card>

        {priceBuilt && (
          <div ref={quoteRef} className="space-y-4">
            <GuidanceQuotePanel />
            {canContinueToTerms && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-primary" onClick={() => setStep('recommendation')}>
                  Continue to deal terms
                  <ArrowRight size={14} />
                </button>
                <span className="text-[0.75rem] text-faint">Gold status, incentives, then accept or challenge.</span>
              </div>
            )}
          </div>
        )}

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

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card title="Demo merchants" subtitle="Seeded deals with known answers.">
          <div className="space-y-2 p-3">
            {demoMerchants.merchants.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setPriceBuilt(false);
                  loadDemo(m.intake as never);
                }}
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
              <strong className="text-ink">Build the price</strong> — guidance take rate appears on this page, under
              volume.
            </li>
            <li>
              <strong className="text-ink">Deal terms</strong> — Gold, incentives and free processing on the next page.
            </li>
            <li>
              <strong className="text-ink">Accept or challenge</strong> — then a printable deal on a page.
            </li>
          </ol>
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
