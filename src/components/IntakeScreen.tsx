'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { book } from '@/lib/book';
import { useQuote, useStore } from '@/lib/store';
import { mccTierFor, primaryFee, vasBandFor, verticalForMcc } from '@/lib/engine';
import { bps, bpsAsPct, feeAmount, int, pct, sym } from '@/lib/format';
import demoMerchants from '../../data/demo-merchants.json' with { type: 'json' };
import { autofillFieldKeys, lookupUrlAutofill } from '@/lib/urlAutofill';
import { GuidanceQuotePanel } from './GuidanceQuotePanel';
import { Card, Chip, Field, NumberInput, Select, TextInput, Toggle } from './ui/primitives';
import type { Currency, Quote, RiskLevel } from '@/lib/types';

export function IntakeScreen() {
  const { intake, patch, setMcc, setVas, setStep, aiFilled, markAiFilled, loadDemo } = useStore();
  const quote = useQuote();
  const [urlAutofillId, setUrlAutofillId] = useState<string | null>(null);
  const [priceBuilt, setPriceBuilt] = useState(false);
  const pricingRef = useRef<HTMLDivElement>(null);

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
  const canContinueToApproval = priceBuilt && quote.status === 'OK' && quote.adjusted?.totalBps != null;

  /**
   * Framework band and MCC tier, resolved here as well as in the engine so the
   * VAS toggles can show a live price before "Build the price" is pressed. Reads
   * the same pure functions the quote does, so the two cannot drift.
   */
  const vasBand = useMemo(
    () =>
      quote.billableMonthlyTpv == null ? null : vasBandFor(book.vas_bands, quote.billableMonthlyTpv / 1_000_000),
    [quote.billableMonthlyTpv],
  );
  const { tier: vasTier, reason: vasTierReason } = useMemo(() => mccTierFor(intake), [intake]);

  function buildPrice() {
    if (!canBuild) return;
    setPriceBuilt(true);
  }

  useEffect(() => {
    if (!priceBuilt) return;
    pricingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [priceBuilt]);


  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
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
          <>
            {/*
              The two sections that build the Sales Rep Adjusted Take Rate, directly
              above it and mirrored in the sticky panel to the right so every change
              lands in view without scrolling. Core acquiring leads because that is
              the order a rep prices in: acquiring economics first, then what is
              layered on top.
            */}
            <div ref={pricingRef} className="space-y-5">
              <Card
                title="Core acquiring"
                subtitle="What you are charging for acquiring itself. Feeds the Sales Rep Adjusted Take Rate — it does not change the Acquirer Guidance recommendation."
                right={
                  quote.adjusted && quote.adjusted.coreAcquiringBps > 0 ? (
                    <Chip tone="blue">{bps(quote.adjusted.coreAcquiringBps)} bps</Chip>
                  ) : (
                    <Chip tone="neutral">Not priced yet</Chip>
                  )
                }
              >
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Field
                    label="Acquirer markup"
                    hint={
                      intake.acquirerMarkupPct == null
                        ? 'Percentage of processed volume. 0.15% is 15 bps.'
                        : `${intake.acquirerMarkupPct}% = ${intake.acquirerMarkupPct * 100} bps`
                    }
                  >
                    <NumberInput
                      value={intake.acquirerMarkupPct}
                      onChange={(v) => patch({ acquirerMarkupPct: v })}
                      suffix="%"
                      placeholder="0.15"
                    />
                  </Field>

                  <Field
                    label="Gateway fee"
                    hint={
                      intake.atv == null
                        ? 'Per transaction. Needs ATV above to convert to bps.'
                        : intake.gatewayFee == null
                          ? `Per transaction. At ${sym(intake.currency)}${intake.atv} ATV, ${sym(intake.currency)}0.10 is ${((0.1 / intake.atv) * 10_000).toFixed(1)} bps.`
                          : `${feeAmount(intake.gatewayFee, intake.gatewayFeeCurrency, 'per_txn')} per transaction`
                    }
                  >
                    <div className="flex gap-2">
                      <div className="w-24 shrink-0">
                        <Select
                          value={intake.gatewayFeeCurrency}
                          onChange={(v) => patch({ gatewayFeeCurrency: v as Currency })}
                          options={Object.keys(book.fx.rates).map((c) => ({ value: c as Currency, label: c }))}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <NumberInput
                          value={intake.gatewayFee}
                          onChange={(v) => patch({ gatewayFee: v })}
                          prefix={sym(intake.gatewayFeeCurrency)}
                          placeholder="0.10"
                        />
                      </div>
                    </div>
                  </Field>
                </div>
                <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] leading-relaxed text-faint">
                  A per-transaction gateway fee is not the same number of basis points — it converts through ATV. At a
                  small basket it is worth far more than it looks.
                </p>
              </Card>

              <Card
                title="Value-added services"
                subtitle="Priced off each product's own framework. The guidance take rate is unaffected — its Other line already carries the VAS uplift — but the floor and ceiling here decide who signs."
                right={
                  <div className="flex flex-wrap justify-end gap-2">
                    {vasBand ? (
                      <Chip
                        tone="blue"
                        title="Product frameworks band on monthly processing volume in the deal currency."
                      >
                        {intake.currency} {vasBand.label}
                      </Chip>
                    ) : (
                      <Chip tone="neutral">Volume needed for a band</Chip>
                    )}
                    <Chip tone={vasTier === 'other' ? 'orange' : 'neutral'} title={vasTierReason}>
                      {vasTier === 'other' ? 'Other MCCs' : 'Standard MCCs'}
                    </Chip>
                  </div>
                }
              >
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                  {book.vas_catalogue.map((fw) => {
                    const fee = primaryFee(fw);
                    const sel = intake.vas[fw.key] ?? { enabled: false, attachRate: fee?.default_attach_rate ?? 1 };
                    const price =
                      fee && vasBand && fee.tiers
                        ? {
                            recommended: fee.tiers[vasTier].recommended[vasBand.index],
                            floor: fee.tiers[vasTier].floor[vasBand.index],
                            ceiling: fee.tiers[vasTier].ceiling[vasBand.index],
                          }
                        : null;
                    const cur = fee?.currency === 'LOCAL' ? intake.currency : (fee?.currency ?? intake.currency);
                    const attachable = fee?.unit === 'per_request' || fee?.unit === 'pct_of_value';

                    return (
                      <div key={fw.key} className="space-y-2">
                        <Toggle
                          checked={sel.enabled}
                          onChange={(on) => setVas(fw.key, { enabled: on })}
                          label={fw.label}
                          hint={
                            fw.needs_extraction
                              ? 'No framework document yet — cannot be priced'
                              : price?.recommended != null
                                ? `Recommended ${feeAmount(price.recommended, cur, fee!.unit)} · ${fee!.basis}`
                                : fw.fees.length > 1
                                  ? `${fw.fees.length} fees · ${fw.mandatory ? 'mandatory' : 'optional'}`
                                  : fee?.basis ?? ''
                          }
                          accent={fw.mandatory ? 'var(--color-lime)' : 'var(--color-blue-bright)'}
                        />

                        {sel.enabled && (
                          <div className="space-y-2.5 rounded-lg border border-line bg-sunken px-3 py-2.5">
                            {price && (
                              <div>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="label !mb-0">Quoting</span>
                                  <span className="text-[0.6875rem] text-faint">
                                    floor {price.floor == null ? '—' : feeAmount(price.floor, cur, fee!.unit)} ·
                                    ceiling{' '}
                                    {price.ceiling == null ? '—' : feeAmount(price.ceiling, cur, fee!.unit)}
                                  </span>
                                </div>
                                <NumberInput
                                  value={sel.quotedAmount ?? price.recommended}
                                  onChange={(v) => setVas(fw.key, { quotedAmount: v })}
                                  prefix={fee!.unit === 'pct_of_value' ? undefined : sym(cur)}
                                  suffix={fee!.unit === 'pct_of_value' ? '%' : undefined}
                                  invalid={
                                    sel.quotedAmount != null &&
                                    ((price.floor != null && sel.quotedAmount < price.floor) ||
                                      (price.ceiling != null && sel.quotedAmount > price.ceiling))
                                  }
                                />
                                {sel.quotedAmount != null && sel.quotedAmount !== price.recommended && (
                                  <button
                                    type="button"
                                    className="mt-1 text-[0.6875rem] text-blue-bright underline decoration-line-strong underline-offset-2"
                                    onClick={() => setVas(fw.key, { quotedAmount: null })}
                                  >
                                    Back to recommended
                                  </button>
                                )}
                              </div>
                            )}

                            {attachable && (
                              <div>
                                <div className="flex items-baseline justify-between">
                                  <span className="label !mb-0">
                                    {fee!.unit === 'pct_of_value' ? 'Share of volume' : 'Attach rate'}
                                  </span>
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
                                  onChange={(e) => setVas(fw.key, { attachRate: Number(e.target.value) / 100 })}
                                  className="mt-1"
                                />
                                <p className="mt-0.5 text-[0.6875rem] leading-snug text-faint">
                                  {fee!.attach_rate_note}
                                </p>
                              </div>
                            )}

                            {/* Integrated Platforms bills per active seller. Nothing else
                                in the intake needs a seller count, so it is asked for
                                here rather than cluttering the merchant panel. */}
                            {fw.fees.some((f) => f.driver === 'per_seller_month') && (
                              <Field label="Active sellers" hint="Drives the per-seller monthly fee">
                                <NumberInput
                                  value={intake.activeSellers}
                                  onChange={(v) => patch({ activeSellers: v })}
                                  placeholder="2500"
                                />
                              </Field>
                            )}

                            {fw.fees.length > 1 && (
                              <p className="text-[0.6875rem] leading-snug text-faint">
                                {fw.fees.length} fees in this framework. The full table, with each fee&apos;s floor, is
                                on the quote below.
                              </p>
                            )}
                            {!price && !fw.needs_extraction && (
                              <p className="text-[0.6875rem] leading-snug text-orange">
                                Enter monthly volume to place this product in a framework band.
                              </p>
                            )}
                            {fw.needs_extraction && (
                              <p className="text-[0.6875rem] leading-snug text-orange">{fw.notes[0]}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] leading-relaxed text-faint">
                  Products with a lime toggle are mandatory — their frameworks say so in as many words. Leaving one off
                  is not a discount, it is a gap in the quote.
                </p>
              </Card>
            </div>

            <GuidanceQuotePanel />

            {/*
              Continue sits at the very bottom: the rep scrolls the whole quote, then
              commits. The adjusted rate they built is the rate that gets approved —
              there is nothing to choose here.
            */}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canContinueToApproval}
                onClick={() => setStep('approval')}
              >
                Continue to approval path
                <ArrowRight size={14} />
              </button>
              <span className="max-w-md text-[0.75rem] leading-snug text-faint">
                {canContinueToApproval
                  ? 'Approvals are measured on the Sales Rep Adjusted Take Rate.'
                  : 'Price core acquiring or a value-added service first — the approval path is driven by the adjusted rate.'}
              </span>
            </div>
          </>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        {priceBuilt && <LiveRatePanel quote={quote} />}

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
              <strong className="text-ink">Build the price</strong> — the recommended take rate appears under volume.
            </li>
            <li>
              <strong className="text-ink">Price the deal</strong> — core acquiring and value-added services build the
              adjusted take rate.
            </li>
            <li>
              <strong className="text-ink">Approval path</strong> — who signs, and the email to send them.
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

/**
 * The sticky readout.
 *
 * The point of moving core acquiring and VAS above the quote is that a rep sees
 * what a change does. That only works if the number stays on screen, so it is
 * repeated here rather than left to the headline further down the page.
 */
function LiveRatePanel({ quote }: { quote: Quote }) {
  const a = quote.adjusted;
  const priced = a?.totalBps != null;
  const discount = quote.discountPct;
  const belowGuidance = discount != null && discount > 0;

  return (
    <Card title="Live take rate" subtitle={priced ? undefined : 'Updates as you price below'}>
      <div className="space-y-3 p-4">
        <div>
          <div className="chip-mono text-faint">Recommended</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold leading-none tnum text-lime">{bps(quote.targetBps)}</span>
            <span className="text-[0.75rem] text-muted">bps</span>
            <span className="tnum text-[0.75rem] text-faint">{bpsAsPct(quote.targetBps)}</span>
          </div>
        </div>

        <div className="border-t border-line pt-3">
          <div className="chip-mono text-faint">Sales rep adjusted</div>
          {priced ? (
            <>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-bold leading-none tnum text-blue-bright">
                  {bps(a!.totalBps)}
                </span>
                <span className="text-[0.75rem] text-muted">bps</span>
                <span className="tnum text-[0.75rem] text-faint">{bpsAsPct(a!.totalBps)}</span>
              </div>
              <p className="mt-1.5 text-[0.6875rem] leading-snug text-faint">
                Core {bps(a!.coreAcquiringBps)} + VAS {bps(a!.vasBps)}
              </p>
            </>
          ) : (
            <div className="mt-0.5 font-display text-3xl font-bold leading-none text-faint">—</div>
          )}
        </div>

        {priced && discount != null && (
          <div className="border-t border-line pt-3">
            <div className="chip-mono text-faint">vs recommended</div>
            <div className="mt-1 flex items-center gap-2">
              <Chip tone={belowGuidance ? 'orange' : 'lime'}>
                {belowGuidance ? `${pct(discount)} discount` : 'at or above guidance'}
              </Chip>
            </div>
            <p className="mt-1.5 text-[0.6875rem] leading-snug text-faint">
              {belowGuidance
                ? 'This is the figure the approval path is based on.'
                : 'No discount approval required at this rate.'}
            </p>
          </div>
        )}

        {priced && a!.incomplete && (
          <p className="border-t border-line pt-3 text-[0.6875rem] leading-snug text-orange">
            One or more lines could not be priced — the total understates the deal.
          </p>
        )}
      </div>
    </Card>
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
