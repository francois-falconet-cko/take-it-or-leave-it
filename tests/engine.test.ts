/**
 * Engine tests. Run: npm run test
 *
 * The golden cases at the bottom check whole quotes against the real Acquirer
 * Framework rows. The unit tests above them check the conversions that are easy
 * to get quietly wrong — per-transaction fees mistaken for basis points, and the
 * variance sign flip that would route a premium deal to the CRO.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Intake, PricingBook } from '../src/lib/types.ts';
import { price } from '../src/lib/engine/index.ts';
import { toBps, effectiveMonthlyTpv, volumeDisagreement, mmbImpliedFloorBps } from '../src/lib/engine/normalize.ts';
import { discountPct, money } from '../src/lib/engine/variance.ts';
import { routeApproval, topApprover } from '../src/lib/engine/approvals.ts';
import { bandContains } from '../src/lib/engine/select.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const book: PricingBook = JSON.parse(readFileSync(resolve(ROOT, 'data/pricing-book.json'), 'utf8'));
const TODAY = '2026-08-04';

function intake(over: Partial<Intake> = {}): Intake {
  return {
    merchantName: 'Test Merchant',
    merchantUrl: '',
    mcc: '',
    vertical: 'Retail',
    verticalOverridden: false,
    region: 'UK',
    countryScope: null,
    riskLevel: 'STD',
    currentAcceptanceRate: null,
    platform: '',
    currentProviders: '',
    currency: 'USD',
    atv: 50,
    monthlyTpv: 3_000_000,
    threeMonthTpv: null,
    annualTpv: null,
    scopePct: 100,
    scopeNote: '',
    contractTerm: '',
    mmb: null,
    isGold: false,
    cashIncentivesUsd: null,
    freeProcessingMonths: null,
    vasFreeTrialMonths: null,
    spException: 'none',
    vas: {},
    repName: 'Test Rep',
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('pricing book integrity', () => {
  test('compiled every framework row', () => {
    assert.equal(book.acquiring.length, 855);
    assert.equal(book.skipped_rows.length, 0);
  });

  test('every row carries provenance', () => {
    for (const r of book.acquiring) {
      assert.ok(r.source_id, `${r.id} missing source_id`);
      assert.ok(r.source_locator, `${r.id} missing source_locator`);
      assert.ok(r.verbatim, `${r.id} missing verbatim`);
    }
  });

  test('every row has a positive total take rate', () => {
    for (const r of book.acquiring) assert.ok(r.total_bps > 0, `${r.id} total_bps=${r.total_bps}`);
  });

  test('bands tile the volume axis without gaps or overlaps', () => {
    const bands = book.monthly_tpv_bands_musd;
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i].min, bands[i - 1].max);
    assert.equal(bands[0].min, 1);
    assert.equal(bands.at(-1)!.max, null);
  });

  test('ships unapproved until a human signs it off', () => {
    assert.equal(book.reviewed_by, null);
  });
});

// ---------------------------------------------------------------------------

describe('fee unit conversion', () => {
  const base = { currency: 'USD', dealCurrency: 'USD' as const, book, billableMonthlyTpv: 5_000_000 };

  test('bps passes through', () => {
    assert.equal(toBps({ ...base, unit: 'bps', amount: 45, atv: 50 }), 45);
  });

  test('pct_of_value scales to bps', () => {
    assert.equal(toBps({ ...base, unit: 'pct_of_value', amount: 0.35, atv: 50 }), 35);
  });

  test('per_txn divides by basket size', () => {
    // $0.01 on a $50 basket is 2 bps, not 1 bp and certainly not 100.
    assert.equal(toBps({ ...base, unit: 'per_txn', amount: 0.01, atv: 50 }), 2);
  });

  test('per_txn is basket-sensitive — the same fee is worth 10x less on a 10x basket', () => {
    const small = toBps({ ...base, unit: 'per_txn', amount: 0.05, atv: 25 })!;
    const large = toBps({ ...base, unit: 'per_txn', amount: 0.05, atv: 250 })!;
    assert.equal(small, 20);
    assert.equal(large, 2);
  });

  test('per_request multiplies by attach rate', () => {
    // A $0.25 RTAU fee that only fires on 5% of transactions is 2.5 bps at a $50
    // basket. Charging it on every transaction would say 50 bps — 20x too much.
    assert.equal(toBps({ ...base, unit: 'per_request', amount: 0.25, atv: 50, attachRate: 0.05 }), 2.5);
    assert.equal(toBps({ ...base, unit: 'per_request', amount: 0.25, atv: 50, attachRate: 1 }), 50);
  });

  test('monthly_flat dilutes as volume grows', () => {
    assert.equal(toBps({ ...base, unit: 'monthly_flat', amount: 250, billableMonthlyTpv: 5_000_000, atv: 50 }), 0.5);
    assert.equal(toBps({ ...base, unit: 'monthly_flat', amount: 250, billableMonthlyTpv: 50_000_000, atv: 50 }), 0.05);
  });

  test('returns null rather than guessing when ATV is missing', () => {
    assert.equal(toBps({ ...base, unit: 'per_txn', amount: 0.01, atv: null }), null);
    assert.equal(toBps({ ...base, unit: 'per_request', amount: 0.25, atv: 0, attachRate: 0.5 }), null);
  });

  test('converts a fee quoted in another currency', () => {
    // $0.01 into GBP at 1.27 is £0.00787; on a £50 basket that is ~1.57 bps.
    const bps = toBps({ ...base, unit: 'per_txn', amount: 0.01, atv: 50, dealCurrency: 'GBP' })!;
    assert.ok(Math.abs(bps - 1.5748) < 0.001, `got ${bps}`);
  });
});

// ---------------------------------------------------------------------------

describe('volume normalization', () => {
  test('prefers monthly, then quarterly, then annual', () => {
    assert.deepEqual(effectiveMonthlyTpv({ monthlyTpv: 5, threeMonthTpv: 30, annualTpv: 120 }), {
      monthly: 5,
      source: 'monthly',
    });
    assert.deepEqual(effectiveMonthlyTpv({ monthlyTpv: null, threeMonthTpv: 30, annualTpv: 120 }), {
      monthly: 10,
      source: 'three_month',
    });
    assert.deepEqual(effectiveMonthlyTpv({ monthlyTpv: null, threeMonthTpv: null, annualTpv: 120 }), {
      monthly: 10,
      source: 'annual',
    });
    assert.equal(effectiveMonthlyTpv({ monthlyTpv: null, threeMonthTpv: null, annualTpv: null }), null);
  });

  test('catches volume figures that contradict each other', () => {
    const agree = volumeDisagreement({ monthlyTpv: 10, threeMonthTpv: 30, annualTpv: 120 });
    assert.ok(agree && agree.spread < 0.01);

    // 10/mo annualizes to 120, but the rep also typed 400 for the year.
    const disagree = volumeDisagreement({ monthlyTpv: 10, threeMonthTpv: null, annualTpv: 400 });
    assert.ok(disagree && disagree.spread > 0.6);

    assert.equal(volumeDisagreement({ monthlyTpv: 10, threeMonthTpv: null, annualTpv: null }), null);
  });

  test('MMB implies a floor take rate', () => {
    assert.equal(mmbImpliedFloorBps(10_000, 5_000_000), 20);
    assert.equal(mmbImpliedFloorBps(null, 5_000_000), null);
    assert.equal(mmbImpliedFloorBps(10_000, 0), null);
  });

  test('band containment is half-open so a boundary volume lands in one band', () => {
    const row = book.acquiring.find((r) => r.region === 'UK' && r.vertical === 'Retail' && r.cat === 3)!;
    assert.equal(row.monthly_tpv_band_musd.min, 5);
    assert.equal(row.monthly_tpv_band_musd.max, 10);
    assert.equal(bandContains(row, 5), true);
    assert.equal(bandContains(row, 9.999), true);
    assert.equal(bandContains(row, 10), false);
    assert.equal(bandContains(row, 4.999), false);
  });
});

// ---------------------------------------------------------------------------

describe('discount and money', () => {
  test('discount is positive below guidance, negative above', () => {
    assert.equal(discountPct({ targetBps: 100, requestedBps: 75 }), 25);
    assert.equal(discountPct({ targetBps: 100, requestedBps: 100 }), 0);
    assert.equal(discountPct({ targetBps: 100, requestedBps: 120 }), -20);
  });

  test('throws rather than dividing by a zero guidance rate', () => {
    assert.throws(() => discountPct({ targetBps: 0, requestedBps: 50 }));
  });

  test('eMNR and revenue at risk', () => {
    const m = money({ billableMonthlyTpv: 10_000_000, targetBps: 100, requestedBps: 75 });
    assert.equal(m.emnrMonthly, 75_000);
    assert.equal(m.emnrAnnual, 900_000);
    // 25 bps given away on $10m/month is $300k a year.
    assert.equal(m.annualRevenueAtRisk, 300_000);
  });
});

// ---------------------------------------------------------------------------

describe('approval routing — non-Gold ladder', () => {
  const matrix = book.approval_matrix;
  const base = {
    matrix,
    annualBillableTpvUsd: 100_000_000,
    intake: {
      isGold: false,
      cashIncentivesUsd: null,
      freeProcessingMonths: null,
      vasFreeTrialMonths: null,
      spException: 'none' as const,
    },
  };

  test('at guidance, nobody signs off', () => {
    const r = routeApproval({ ...base, discountPct: 0 });
    assert.equal(r.required, false);
    assert.deepEqual(r.approvers, []);
  });

  test('pricing ABOVE guidance does not need approval', () => {
    // The trap: a naive "variance < 25% -> Regional Leader" rule sends a rep
    // pricing 20% above guidance to chase a signature they do not need.
    const r = routeApproval({ ...base, discountPct: -20 });
    assert.equal(r.required, false);
    assert.equal(r.approvers.length, 0);
  });

  test('up to 25% discount is the Regional Leader', () => {
    const r = routeApproval({ ...base, discountPct: 10 });
    assert.deepEqual(r.approvers.map((a) => a.name), ['Regional Leader']);
    assert.equal(r.emailOwner, 'rep');
  });

  test('exactly 25% lands in the 25-50 band, once', () => {
    const r = routeApproval({ ...base, discountPct: 25 });
    assert.deepEqual(r.approvers.map((a) => a.name).sort(), ['CRO', 'Regional Leader']);
  });

  test('above 25% Strategic Pricing owns the approval email, not the rep', () => {
    assert.equal(routeApproval({ ...base, discountPct: 24.9 }).emailOwner, 'rep');
    assert.equal(routeApproval({ ...base, discountPct: 25.1 }).emailOwner, 'Strategic Pricing');
  });

  test('over 50% reaches the CEO', () => {
    const r = routeApproval({ ...base, discountPct: 60 });
    assert.equal(topApprover(r), 'CEO');
    assert.equal(r.managedBy, 'Strategic Pricing');
  });

  test('non-Gold deals have no QTC written-approval gate', () => {
    assert.equal(routeApproval({ ...base, discountPct: 60 }).qtcGate, null);
  });
});

describe('approval routing — Gold ladder', () => {
  const matrix = book.approval_matrix;
  const gold = {
    matrix,
    annualBillableTpvUsd: 100_000_000,
    intake: {
      isGold: true,
      cashIncentivesUsd: null,
      freeProcessingMonths: null,
      vasFreeTrialMonths: null,
      spException: 'none' as const,
    },
  };

  test('a Gold deal AT guidance still needs Team Leader and Strategic Pricing', () => {
    const r = routeApproval({ ...gold, discountPct: 0 });
    assert.equal(r.required, true);
    assert.deepEqual(r.approvers.map((a) => a.name).sort(), ['Strategic Pricing', 'Team Leader']);
  });

  test('Gold escalates earlier than non-Gold — 15% reaches the Regional Leader', () => {
    const g = routeApproval({ ...gold, discountPct: 15 });
    assert.ok(g.approvers.some((a) => a.name === 'Regional Leader'));
    assert.ok(g.approvers.some((a) => a.name === 'Strategic Pricing'));
  });

  test('$1bn of annualized volume puts a non-Gold deal on the Gold ladder', () => {
    const r = routeApproval({
      ...gold,
      intake: { ...gold.intake, isGold: false },
      annualBillableTpvUsd: 1_200_000_000,
      discountPct: 5,
    });
    assert.equal(r.track, 'gold');
    assert.match(r.goldReason ?? '', /1bn/);
  });

  test('cash incentives above $500k reach the CEO regardless of band', () => {
    const r = routeApproval({
      ...gold,
      discountPct: 5,
      intake: { ...gold.intake, cashIncentivesUsd: 750_000 },
    });
    assert.equal(topApprover(r), 'CEO');
  });

  test('Gold deals carry the QTC written-approval gate', () => {
    const r = routeApproval({ ...gold, discountPct: 5 });
    assert.ok(r.qtcGate);
    assert.deepEqual(r.qtcGate!.signatories, ['Antoine', 'Guillaume']);
  });
});

describe('approval routing — Strategic Pricing exceptions and side tracks', () => {
  const matrix = book.approval_matrix;
  const base = {
    matrix,
    annualBillableTpvUsd: 100_000_000,
    intake: {
      isGold: false,
      cashIncentivesUsd: null,
      freeProcessingMonths: null,
      vasFreeTrialMonths: null,
      spException: 'none' as const,
    },
  };

  test('a <=5% adjustment to CRO-approved pricing does not re-escalate to the CRO', () => {
    const withCro = routeApproval({ ...base, discountPct: 30 });
    assert.ok(withCro.approvers.some((a) => a.name === 'CRO'));

    const exception = routeApproval({
      ...base,
      discountPct: 4,
      intake: { ...base.intake, spException: 'minor_adjustment_le_5pct' },
    });
    // At 4% the band is Regional Leader anyway, so the exception is inert.
    assert.ok(!exception.approvers.some((a) => a.name === 'CRO'));
  });

  test('adding an entity to an approved merchant routes to Strategic Pricing alone', () => {
    const r = routeApproval({
      ...base,
      discountPct: 30,
      intake: { ...base.intake, spException: 'new_entity_only' },
    });
    assert.deepEqual(r.approvers.map((a) => a.name), ['Strategic Pricing']);
    assert.ok(r.spExceptionApplied);
  });

  test('free processing runs its own ladder alongside the discount one', () => {
    const short = routeApproval({ ...base, discountPct: 5, intake: { ...base.intake, freeProcessingMonths: 3 } });
    assert.deepEqual(short.sideTracks[0].approvers, ['Regional Revenue Leader']);

    const long = routeApproval({ ...base, discountPct: 5, intake: { ...base.intake, freeProcessingMonths: 6 } });
    assert.deepEqual(long.sideTracks[0].approvers, ['CRO']);
  });

  test('free processing is flagged even when the take rate is at guidance', () => {
    const r = routeApproval({ ...base, discountPct: 0, intake: { ...base.intake, vasFreeTrialMonths: 5 } });
    assert.equal(r.required, false);
    assert.equal(r.sideTracks.length, 1);
    assert.deepEqual(r.sideTracks[0].approvers, ['CRO']);
  });
});

// ---------------------------------------------------------------------------
// Golden cases — whole quotes against real framework rows.
// ---------------------------------------------------------------------------

describe('golden case 1 — UK Retail, $3m/month, at guidance', () => {
  const q = price(intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, atv: 49 }), book, TODAY);

  test('lands in Cat 2 (2.5-5m/month)', () => {
    assert.equal(q.status, 'OK');
    assert.equal(q.band?.cat, 2);
  });

  test('quotes the framework total verbatim: 0.384% = 38.4 bps', () => {
    // UK / Retail / Cat 2: acq 0.300% + other 0.084% = total 0.384%
    assert.equal(q.match?.acquiring_bps, 30);
    assert.equal(q.match?.other_bps, 8.4);
    assert.equal(q.targetBps, 38.4);
  });

  test('decomposition sums to the target', () => {
    const sum = q.lines.reduce((s, l) => s + l.bps, 0);
    assert.ok(Math.abs(sum - q.targetBps!) < 0.001, `lines sum ${sum} vs target ${q.targetBps}`);
  });

  test('every line cites a source', () => {
    for (const l of q.lines) {
      assert.ok(l.sourceId && l.sourceLocator && l.verbatim, `${l.key} missing provenance`);
    }
  });

  test('at guidance there is no approval and no revenue at risk', () => {
    const atGuidance = price(
      intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, atv: 49 }),
      book,
      TODAY,
      { requestedBps: 38.4 },
    );
    assert.equal(atGuidance.discountPct, 0);
    assert.equal(atGuidance.approval?.required, false);
    assert.equal(atGuidance.annualRevenueAtRisk, 0);
  });
});

describe('golden case 2 — NORAM Digital, 50% scope, per-request VAS', () => {
  const i = intake({
    region: 'NORAM',
    vertical: 'Digital',
    monthlyTpv: 20_000_000,
    scopePct: 50,
    atv: 30,
    vas: {
      network_tokens: { enabled: true, attachRate: 1 },
      rtau: { enabled: true, attachRate: 0.05 },
      fraud_detection: { enabled: true, attachRate: 1 },
    },
  });
  const q = price(i, book, TODAY, { requestedBps: 30 });

  test('bands on Checkout-processed volume, not merchant total', () => {
    // $20m total at 50% scope is $10m to us -> Cat 4, not the Cat 4/5 of the total.
    assert.equal(q.billableMonthlyTpv, 10_000_000);
    assert.equal(q.band?.cat, 4);
    assert.ok(q.findings.some((f) => f.code === 'BAND_ON_SCOPED_VOLUME' || q.band?.catOnTotalVolume === 4));
  });

  test('transaction count uses the scoped volume', () => {
    assert.equal(q.monthlyTxns, 10_000_000 / 30);
  });

  test('eMNR is computed on scoped volume', () => {
    // $10m x 30bps = $30k/month.
    assert.equal(q.emnrMonthly, 30_000);
    assert.equal(q.emnrAnnual, 360_000);
  });

  test('VAS attach check reports unverified list prices rather than a fake total', () => {
    assert.ok(q.vasCheck);
    assert.equal(q.vasCheck!.anyUnverified, true);
    assert.equal(q.vasCheck!.lines.length, 3);
    const rtau = q.vasCheck!.lines.find((l) => l.key === 'rtau')!;
    assert.equal(rtau.unit, 'per_request');
    assert.equal(rtau.attachRate, 0.05);
    // $0.25 x 5% / $30 basket = 4.167 bps
    assert.ok(Math.abs(rtau.bps! - 4.167) < 0.01, `got ${rtau.bps}`);
  });

  test('the VAS attach check does not change the guidance target', () => {
    const withoutVas = price({ ...i, vas: {} }, book, TODAY, { requestedBps: 30 });
    assert.equal(q.targetBps, withoutVas.targetBps);
  });
});

describe('golden case 3 — EEA Digital with the FRIT country override', () => {
  const at3m = (scope: string | null) =>
    price(intake({ region: 'EEA', vertical: 'Digital', monthlyTpv: 3_000_000, countryScope: scope }), book, TODAY);
  const at300m = (scope: string | null) =>
    price(intake({ region: 'EEA', vertical: 'Digital', monthlyTpv: 300_000_000, countryScope: scope }), book, TODAY);

  test('FRIT resolves to its own row: 0.639% = 63.9 bps at Cat 2', () => {
    assert.equal(at3m('FRIT').match?.country_scope, 'FRIT');
    assert.equal(at3m('FRIT').targetBps, 63.9);
  });

  test('a merchant with no country scope is priced off the regional row, never FRIT', () => {
    const regional = at3m(null);
    assert.equal(regional.match?.country_scope, null);
    assert.notEqual(regional.match?.id, at3m('FRIT').match?.id);
  });

  test('the override actually bites where the two rows diverge — Cat 8', () => {
    // FRIT and the EEA default happen to agree up to Cat 7 and part ways above
    // it: 12.8 bps regional vs 11.4 bps FRIT at $250-500m/month.
    assert.equal(at300m(null).targetBps, 12.8);
    assert.equal(at300m('FRIT').targetBps, 11.4);
  });
});

describe('golden case 4 — high risk uplift', () => {
  test('a standard vertical marked high risk takes the +15% uplift', () => {
    const std = price(intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, riskLevel: 'STD' }), book, TODAY);
    const high = price(intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, riskLevel: 'HIGH' }), book, TODAY);

    assert.equal(std.targetBps, 38.4);
    // 38.4 x 1.15 = 44.16
    assert.equal(high.targetBps, 44.16);
    assert.ok(high.lines.some((l) => l.key === 'high_risk_uplift'));
  });

  test('a vertical already priced as high risk takes no further uplift', () => {
    const std = price(intake({ region: 'APAC', vertical: 'Gambling', monthlyTpv: 3_000_000, riskLevel: 'STD' }), book, TODAY);
    const high = price(intake({ region: 'APAC', vertical: 'Gambling', monthlyTpv: 3_000_000, riskLevel: 'HIGH' }), book, TODAY);

    assert.equal(high.targetBps, std.targetBps);
    assert.ok(high.findings.some((f) => f.code === 'HIGH_RISK_ALREADY_PRICED'));
  });
});

describe('golden case 5 — the tool must be able to say no', () => {
  test('a region outside the guidance is UNMAPPED, not approximated', () => {
    const q = price(intake({ region: 'LATAM', vertical: 'Retail', monthlyTpv: 5_000_000 }), book, TODAY);
    assert.equal(q.status, 'UNMAPPED');
    assert.equal(q.targetBps, null);
    assert.ok(q.findings.some((f) => f.code === 'UNMAPPED_REGION'));
    assert.ok(q.searchedFor, 'must report what it searched for');
  });

  test('a vertical outside the guidance is UNMAPPED and offers context, not a rate', () => {
    const q = price(intake({ region: 'UK', vertical: 'Marketplace', monthlyTpv: 5_000_000 }), book, TODAY);
    assert.equal(q.status, 'UNMAPPED');
    assert.equal(q.targetBps, null);
    assert.ok(q.nearest.length > 0, 'should offer adjacent rows as context');
    for (const n of q.nearest) assert.notEqual(n.vertical, 'Marketplace');
  });

  test('below the $1m/month floor there is no guidance to discount against', () => {
    const q = price(intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 400_000 }), book, TODAY);
    assert.equal(q.status, 'UNMAPPED');
    assert.ok(q.findings.some((f) => f.code === 'BELOW_GUIDANCE_FLOOR'));
  });

  test('no volume at all blocks instead of assuming one', () => {
    const q = price(
      intake({ monthlyTpv: null, threeMonthTpv: null, annualTpv: null }),
      book,
      TODAY,
    );
    assert.equal(q.status, 'BLOCKED');
    assert.ok(q.findings.some((f) => f.code === 'NO_VOLUME'));
  });

  test('a non-positive requested rate blocks', () => {
    const q = price(intake(), book, TODAY, { requestedBps: 0 });
    assert.equal(q.status, 'BLOCKED');
    assert.ok(q.findings.some((f) => f.code === 'REQUESTED_NOT_POSITIVE'));
  });
});

describe('golden case 6 — MMB conflict and Gold escalation end to end', () => {
  test('an MMB above the requested rate is flagged as the real price', () => {
    // $50k MMB on $5m monthly volume is 100 bps — far above a 40 bps request.
    const q = price(intake({ monthlyTpv: 5_000_000, mmb: 50_000 }), book, TODAY, { requestedBps: 40 });
    assert.ok(q.mmbImpliedFloorBps! > 40);
    assert.equal(q.mmbBinds, true);
    assert.ok(q.findings.some((f) => f.code === 'MMB_BINDS'));
  });

  test('a deep discount on a Gold deal reaches the CEO and Strategic Pricing owns the email', () => {
    const q = price(
      intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, isGold: true }),
      book,
      TODAY,
      { requestedBps: 15 },
    );
    // 38.4 -> 15 bps is a 60.9% discount.
    assert.ok(q.discountPct! > 50);
    assert.equal(topApprover(q.approval!), 'CEO');
    assert.equal(q.approval!.emailOwner, 'Strategic Pricing');
    assert.ok(q.approval!.qtcGate);
  });

  test('the same discount on a non-Gold deal skips the QTC gate', () => {
    const q = price(
      intake({ region: 'UK', vertical: 'Retail', monthlyTpv: 3_000_000, isGold: false }),
      book,
      TODAY,
      { requestedBps: 15 },
    );
    assert.equal(topApprover(q.approval!), 'CEO');
    assert.equal(q.approval!.qtcGate, null);
  });
});

describe('purity', () => {
  test('same inputs produce identical quotes', () => {
    const i = intake({ monthlyTpv: 7_500_000, atv: 42 });
    const a = price(i, book, TODAY, { requestedBps: 30 });
    const b = price(i, book, TODAY, { requestedBps: 30 });
    assert.deepEqual(a, b);
  });

  test('today is a parameter, so staleness is deterministic', () => {
    const i = intake();
    const near = price(i, book, '2026-08-04');
    const far = price(i, book, '2027-08-04');
    assert.equal(near.findings.some((f) => f.code === 'SOURCE_STALE'), false);
    assert.equal(far.findings.some((f) => f.code === 'SOURCE_STALE'), true);
  });

  test('the engine does not mutate the intake or the book', () => {
    const i = intake();
    const snapshot = JSON.stringify(i);
    const bookSnapshot = JSON.stringify(book.acquiring.slice(0, 20));
    price(i, book, TODAY, { requestedBps: 30 });
    assert.equal(JSON.stringify(i), snapshot);
    assert.equal(JSON.stringify(book.acquiring.slice(0, 20)), bookSnapshot);
  });
});
