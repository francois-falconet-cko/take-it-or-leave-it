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
import { mccTierFor, vasBandFor } from '../src/lib/engine/vas.ts';
import { macSectorsFor } from '../src/lib/engine/mac.ts';
import { resolveRecipient } from '../src/lib/approvers.ts';
import { buildApprovalEmail } from '../src/lib/email.ts';

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
    chargebackRatioPct: null,
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
    activeSellers: null,
    acquirerMarkupPct: null,
    gatewayFee: null,
    gatewayFeeCurrency: 'USD',
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

  test('approval is all-or-nothing, and only a human can grant it', () => {
    // This used to assert reviewed_by === null, which held only until someone ran
    // book:approve. The invariant that actually matters is that a signature and a
    // date travel together: a book claiming a reviewer with no timestamp, or a
    // timestamp with no reviewer, is a book nobody can be held to.
    if (book.reviewed_by == null) {
      assert.equal(book.reviewed_at, null, 'no reviewer, but a review date');
    } else {
      assert.ok(book.reviewed_at, `signed off by ${book.reviewed_by} with no date`);
      assert.ok(!Number.isNaN(Date.parse(book.reviewed_at)), 'review date is not a date');
    }
  });
});

describe('product pricing framework integrity', () => {
  test('VAS bands tile the volume axis without gaps or overlaps', () => {
    const bands = book.vas_bands;
    for (let i = 1; i < bands.length; i++) assert.equal(bands[i].min, bands[i - 1].max);
    assert.equal(bands[0].min, 0.5);
    assert.equal(bands.at(-1)!.max, null);
  });

  test('the VAS band ladder is NOT the acquiring band ladder', () => {
    // Both exist in the book and both are "monthly volume bands". Anything that
    // treats them as interchangeable prices the wrong cell, so this asserts they
    // are genuinely different rather than trusting a comment to say so.
    assert.notEqual(book.vas_bands[0].min, book.monthly_tpv_bands_musd[0].min);
    assert.notDeepEqual(
      book.vas_bands.map((b) => b.min),
      book.monthly_tpv_bands_musd.slice(0, book.vas_bands.length).map((b) => b.min),
    );
  });

  test('every documented framework prices both MCC tiers across every band', () => {
    for (const fw of book.vas_catalogue) {
      if (fw.needs_extraction) continue;
      for (const fee of fw.fees) {
        if (fee.tiers == null) continue;
        for (const tier of ['standard', 'other'] as const) {
          for (const level of ['recommended', 'floor', 'ceiling'] as const) {
            assert.equal(
              fee.tiers[tier][level].length,
              book.vas_bands.length,
              `${fw.key}/${fee.key}/${tier}/${level} has ${fee.tiers[tier][level].length} values for ${book.vas_bands.length} bands`,
            );
          }
        }
      }
    }
  });

  test('Other MCCs is never cheaper than Standard MCCs', () => {
    // The whole point of the tier split. If a transcription ever inverts a pair,
    // a high-chargeback merchant gets quoted the clean-merchant price.
    for (const fw of book.vas_catalogue) {
      if (fw.needs_extraction) continue;
      for (const fee of fw.fees) {
        if (fee.tiers == null) continue;
        fee.tiers.standard.recommended.forEach((std, i) => {
          const other = fee.tiers!.other.recommended[i];
          if (std == null || other == null) return;
          assert.ok(other >= std, `${fw.key}/${fee.key} at ${book.vas_bands[i].label}: other ${other} < standard ${std}`);
        });
      }
    }
  });

  test('floor never exceeds recommended, ceiling never falls below it', () => {
    for (const fw of book.vas_catalogue) {
      for (const fee of fw.fees) {
        if (fee.tiers == null) continue;
        for (const tier of ['standard', 'other'] as const) {
          const t = fee.tiers[tier];
          t.recommended.forEach((rec, i) => {
            if (rec == null) return;
            const label = `${fw.key}/${fee.key}/${tier} at ${book.vas_bands[i].label}`;
            if (t.floor[i] != null) assert.ok(t.floor[i]! <= rec, `${label}: floor ${t.floor[i]} > rec ${rec}`);
            if (t.ceiling[i] != null) assert.ok(t.ceiling[i]! >= rec, `${label}: ceiling ${t.ceiling[i]} < rec ${rec}`);
          });
        }
      }
    }
  });

  test('every framework carries provenance, and undocumented ones say so', () => {
    for (const fw of book.vas_catalogue) {
      assert.ok(fw.source_id, `${fw.key} missing source_id`);
      if (fw.needs_extraction) {
        assert.equal(fw.confidence, 'unverified', `${fw.key} needs extraction but is not unverified`);
        assert.ok(fw.fees.every((f) => f.tiers == null), `${fw.key} needs extraction but carries prices`);
      } else {
        assert.notEqual(fw.confidence, 'unverified', `${fw.key} is documented but still unverified`);
        assert.ok(fw.approval_verbatim, `${fw.key} is documented but states no approval path`);
      }
    }
  });

  test('six of the eight products now have a framework', () => {
    const documented = book.vas_catalogue.filter((v) => !v.needs_extraction).map((v) => v.key).sort();
    assert.deepEqual(documented, [
      'apms',
      'authentication',
      'fraud_detection',
      'integrated_platforms',
      'network_tokens',
      'rtau',
    ]);
    assert.deepEqual(
      book.vas_catalogue.filter((v) => v.needs_extraction).map((v) => v.key).sort(),
      ['forward_vault', 'settlement'],
    );
  });
});

describe('MAC integrity', () => {
  test('parsed every sector and the pre-submission gate', () => {
    assert.equal(book.mac.sectors.length, 30);
    assert.equal(book.mac.chargeback_ceiling_pct, 0.9);
    assert.ok(book.mac.pre_submission_checklist.length >= 7);
  });

  test('every sector has criteria and provenance', () => {
    for (const s of book.mac.sectors) {
      assert.ok(s.criteria.length > 0, `${s.key} has no criteria`);
      assert.ok(s.source_locator, `${s.key} has no locator`);
    }
  });

  test('a stated tier without a dollar figure asserts no floor', () => {
    // Four sectors say "Tier 3 and above" and never name a number. Inventing one
    // would put a fabricated threshold in front of a rep, so they carry null.
    const tierOnly = book.mac.sectors.filter((s) => s.min_monthly_net_revenue_usd == null);
    assert.equal(tierOnly.length, 4);
    for (const s of tierOnly) {
      assert.ok(
        s.net_revenue_verbatim == null || !/\$/.test(s.net_revenue_verbatim),
        `${s.key} has no floor but its verbatim names a figure: ${s.net_revenue_verbatim}`,
      );
    }
  });

  test('every mapped vertical is a vertical the framework actually has', () => {
    for (const s of book.mac.sectors) {
      for (const v of s.verticals) {
        assert.ok(book.dimensions.verticals.includes(v), `${s.key} maps to unknown vertical "${v}"`);
      }
    }
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

  test('VAS is priced off the product frameworks, not a placeholder', () => {
    assert.ok(q.vasCheck);
    // All three of these products now have their framework document.
    assert.equal(q.vasCheck!.anyUnverified, false);
    assert.equal(q.vasCheck!.lines.length, 3);

    // $10m/month in USD sits in the 10m-20m product band, which is index 4. Note
    // this is NOT the acquiring Cat 4 above — the two ladders differ and happening
    // to share a number here is a coincidence worth not relying on.
    assert.equal(q.vasCheck!.band?.label, '10m - 20m');
    assert.equal(q.vasCheck!.band?.index, 4);
    assert.equal(q.vasCheck!.tier, 'standard');

    const rtau = q.vasCheck!.lines.find((l) => l.frameworkKey === 'rtau')!;
    assert.equal(rtau.unit, 'per_request');
    assert.equal(rtau.attachRate, 0.05);
    // RTAU Standard MCCs at 10m-20m: recommended 0.15, floor 0.11, ceiling 0.25.
    assert.equal(rtau.recommended, 0.15);
    assert.equal(rtau.floor, 0.11);
    assert.equal(rtau.ceiling, 0.25);
    assert.equal(rtau.verdict, 'at_recommended');
    // $0.15 x 5% / $30 basket = 2.5 bps. Charged against every transaction instead
    // of just the retried ones it would read 50 bps — the 20x error this guards.
    assert.ok(Math.abs(rtau.bps! - 2.5) < 0.01, `got ${rtau.bps}`);
  });

  test('a per-request fee is not mistaken for the same number of basis points', () => {
    const nt = q.vasCheck!.lines.find((l) => l.frameworkKey === 'network_tokens')!;
    // Network Tokens Standard at 10m-20m is $0.07 per event, attach 1.0.
    // $0.07 / $30 x 10,000 = 23.333 bps. Not 7, and not 0.07.
    assert.equal(nt.amount, 0.07);
    assert.ok(Math.abs(nt.bps! - 23.333) < 0.01, `got ${nt.bps}`);
  });

  test('the framework total is the sum of the priced products', () => {
    // 23.333 (NT) + 2.5 (RTAU) + 6.667 (FD Pro at $0.02 / $30) = 32.5 bps.
    assert.ok(Math.abs(q.vasCheck!.selectedListPriceBps! - 32.5) < 0.01, `got ${q.vasCheck!.selectedListPriceBps}`);
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

describe('product framework banding and MCC tier', () => {
  const withRtau = (over: Partial<Intake>) =>
    price(intake({ vas: { rtau: { enabled: true, attachRate: 0.05 } }, ...over }), book, TODAY);

  test('bands are read in the deal currency, not converted to USD', () => {
    // £3m/month is $3.81m at the book's 1.27 rate. The VAS band must be the 2m-5m
    // one either way here, but the ACQUIRING band differs — £3m converts to Cat 2
    // ($2.5-5m) while the VAS ladder puts £3m in 2m-5m. This asserts the VAS side
    // reads the pound figure: at £6m the two would diverge outright.
    const gbp = withRtau({ currency: 'GBP', monthlyTpv: 6_000_000, region: 'UK' });
    assert.equal(gbp.vasCheck!.band?.label, '5m - 10m');
    // $7.62m in USD terms would fall in the same 5m-10m band, so push further:
    const gbpBig = withRtau({ currency: 'GBP', monthlyTpv: 18_000_000, region: 'UK' });
    assert.equal(gbpBig.vasCheck!.band?.label, '10m - 20m');
    // Converted to USD, £18m is $22.86m, which would have been the 20m+ band.
    const usd = withRtau({ currency: 'USD', monthlyTpv: 22_860_000, region: 'UK' });
    assert.equal(usd.vasCheck!.band?.label, '20m+');
  });

  test('a merchant is priced up a band as volume grows', () => {
    const small = withRtau({ monthlyTpv: 3_000_000 });
    const large = withRtau({ monthlyTpv: 30_000_000 });
    // RTAU Standard: 0.20 at 2m-5m, 0.15 at 20m+.
    assert.equal(small.vasCheck!.lines[0].recommended, 0.2);
    assert.equal(large.vasCheck!.lines[0].recommended, 0.15);
    assert.ok(large.vasCheck!.lines[0].bps! < small.vasCheck!.lines[0].bps!);
  });

  test('chargebacks above 1% move the merchant to the Other MCCs table', () => {
    const clean = withRtau({ monthlyTpv: 3_000_000, chargebackRatioPct: 0.4 });
    const dirty = withRtau({ monthlyTpv: 3_000_000, chargebackRatioPct: 1.4 });
    assert.equal(clean.vasCheck!.tier, 'standard');
    assert.equal(dirty.vasCheck!.tier, 'other');
    // RTAU at 2m-5m: Standard recommends 0.20, Other recommends 0.25.
    assert.equal(clean.vasCheck!.lines[0].recommended, 0.2);
    assert.equal(dirty.vasCheck!.lines[0].recommended, 0.25);
  });

  test('high risk also lands on the Other table, and says which test it used', () => {
    const q = withRtau({ monthlyTpv: 3_000_000, riskLevel: 'HIGH', vertical: 'Gambling', region: 'EEA' });
    assert.equal(q.vasCheck!.tier, 'other');
    assert.match(q.vasCheck!.tierReason, /high risk/i);
  });

  test('the MCC tier is a different axis from the acquiring risk level', () => {
    // Gambling rows are risk_level ALL — already priced as high risk on acquiring,
    // so no uplift. That must not stop the product frameworks using Other MCCs.
    const q = withRtau({ vertical: 'Gambling', region: 'EEA', riskLevel: 'HIGH', monthlyTpv: 3_000_000 });
    assert.equal(q.match!.risk_level, 'ALL');
    assert.equal(q.vasCheck!.tier, 'other');
  });

  test('below the 500k framework floor there is no band', () => {
    // Tested against vasBandFor directly rather than through price(), because the
    // two floors do not overlap: the product frameworks start at 500k local and
    // acquiring guidance starts at $1m, and $1m is at least 787k in any currency
    // the book carries. So a deal that reaches the VAS check has always cleared
    // 500k already, and price() returns UNMAPPED before it gets here.
    assert.equal(vasBandFor(book.vas_bands, 0.4), null);
    assert.equal(vasBandFor(book.vas_bands, 0.5)?.label, '500k - 1m');
  });

  test('the tier rule reads chargebacks before it falls back to risk level', () => {
    // Order matters: the chargeback ratio is a fact off a statement, the risk level
    // is a classification. When both are present the ratio should be the reason
    // given, so a rep reading the tooltip sees the evidence rather than the label.
    const bothTrip = mccTierFor(intake({ riskLevel: 'HIGH', chargebackRatioPct: 2 }));
    assert.equal(bothTrip.tier, 'other');
    assert.match(bothTrip.reason, /2%/);

    const onlyRisk = mccTierFor(intake({ riskLevel: 'HIGH', chargebackRatioPct: null }));
    assert.match(onlyRisk.reason, /high risk/i);

    // A high-risk vertical with clean chargebacks is still Other — the deck's rule
    // is an OR, not an AND.
    assert.equal(mccTierFor(intake({ riskLevel: 'HIGH', chargebackRatioPct: 0.2 })).tier, 'other');
    assert.equal(mccTierFor(intake({ riskLevel: 'STD', chargebackRatioPct: 0.2 })).tier, 'standard');
  });

  test('exactly 1% is inside the line, not over it', () => {
    // The deck says "above 1%". A merchant at precisely 1.0% keeps Standard pricing.
    assert.equal(mccTierFor(intake({ chargebackRatioPct: 1 })).tier, 'standard');
    assert.equal(mccTierFor(intake({ chargebackRatioPct: 1.01 })).tier, 'other');
  });

  test('the band boundaries are half-open, so a merchant sits in exactly one', () => {
    assert.equal(vasBandFor(book.vas_bands, 2)?.label, '2m - 5m');
    assert.equal(vasBandFor(book.vas_bands, 4.999)?.label, '2m - 5m');
    assert.equal(vasBandFor(book.vas_bands, 5)?.label, '5m - 10m');
    assert.equal(vasBandFor(book.vas_bands, 20)?.label, '20m+');
    assert.equal(vasBandFor(book.vas_bands, 5_000)?.label, '20m+');
  });
});

describe('product framework floors and ceilings', () => {
  const quoteRtau = (amount: number) =>
    price(
      intake({ monthlyTpv: 3_000_000, vas: { rtau: { enabled: true, attachRate: 0.05, quotedAmount: amount } } }),
      book,
      TODAY,
    );

  // RTAU Standard MCCs at 2m-5m: floor 0.13, recommended 0.20, ceiling 0.25.
  test('at the recommendation, nobody signs anything', () => {
    const q = quoteRtau(0.2);
    assert.equal(q.vasCheck!.lines[0].verdict, 'at_recommended');
    assert.deepEqual(q.vasCheck!.lines[0].approvers, []);
    assert.equal(q.findings.some((f) => f.code.startsWith('VAS_BELOW_FLOOR')), false);
  });

  test('below the recommendation but above the floor still needs nobody', () => {
    const q = quoteRtau(0.15);
    assert.equal(q.vasCheck!.lines[0].verdict, 'below_recommended');
    assert.deepEqual(q.vasCheck!.lines[0].approvers, []);
  });

  test('below the floor routes to the approver the framework names', () => {
    const q = quoteRtau(0.1);
    const line = q.vasCheck!.lines[0];
    assert.equal(line.verdict, 'below_floor');
    // The RTAU deck says Regional Sales Leader, where the other five say Regional
    // Revenue Leader. Carried as written rather than normalised.
    assert.deepEqual(line.approvers, ['Regional Sales Leader']);
    assert.ok(q.findings.some((f) => f.code === 'VAS_BELOW_FLOOR'));
  });

  test('above the ceiling is flagged too — the merchant will find out', () => {
    const q = quoteRtau(0.4);
    assert.equal(q.vasCheck!.lines[0].verdict, 'above_ceiling');
    assert.ok(q.findings.some((f) => f.code === 'VAS_ABOVE_CEILING'));
  });

  test('a quoted price is marked as quoted, an unquoted one is not', () => {
    assert.equal(quoteRtau(0.15).vasCheck!.lines[0].quoted, true);
    const def = price(
      intake({ monthlyTpv: 3_000_000, vas: { rtau: { enabled: true, attachRate: 0.05 } } }),
      book,
      TODAY,
    );
    assert.equal(def.vasCheck!.lines[0].quoted, false);
    assert.equal(def.vasCheck!.lines[0].amount, def.vasCheck!.lines[0].recommended);
  });

  test('product prices never move the guidance take rate', () => {
    const bare = price(intake({ monthlyTpv: 3_000_000 }), book, TODAY);
    const loaded = quoteRtau(0.25);
    assert.equal(bare.targetBps, loaded.targetBps);
  });

  test('a framework that forbids free trials flags one', () => {
    const q = price(
      intake({
        monthlyTpv: 3_000_000,
        vasFreeTrialMonths: 3,
        vas: { rtau: { enabled: true, attachRate: 0.05 } },
      }),
      book,
      TODAY,
    );
    assert.ok(q.findings.some((f) => f.code === 'VAS_FREE_TRIAL_NOT_ALLOWED'));
  });

  test('Integrated Platforms is out of scope outside EEA/UK/US', () => {
    const apac = price(
      intake({ region: 'APAC', vertical: 'Retail', monthlyTpv: 3_000_000, vas: { integrated_platforms: { enabled: true, attachRate: 1 } } }),
      book,
      TODAY,
    );
    assert.ok(apac.findings.some((f) => f.code === 'VAS_OUT_OF_SCOPE_REGION'));
  });

  test('a fee with no driver in the intake reports why, not a number', () => {
    const q = price(
      intake({ region: 'UK', monthlyTpv: 3_000_000, vas: { integrated_platforms: { enabled: true, attachRate: 1 } } }),
      book,
      TODAY,
    );
    const payout = q.vasCheck!.lines.find((l) => l.key === 'ip_bank_payout_fee')!;
    // The rate is real and shown; the bps is not, because payout count does not
    // follow from transaction count. A guess here would be indistinguishable.
    assert.ok(payout.recommended != null);
    assert.equal(payout.bps, null);
    assert.ok(payout.notModelledReason);
  });

  test('the per-seller fee needs a seller count and says so when it has none', () => {
    const base = { region: 'UK', monthlyTpv: 3_000_000, vas: { integrated_platforms: { enabled: true, attachRate: 1 } } };
    const without = price(intake(base), book, TODAY);
    const with2500 = price(intake({ ...base, activeSellers: 2500 }), book, TODAY);
    const key = 'ip_monthly_seller_fee';
    assert.equal(without.vasCheck!.lines.find((l) => l.key === key)!.bps, null);
    // 2500 sellers x £1.00 = £2,500/month on £3m = 8.333 bps.
    const bpsOut = with2500.vasCheck!.lines.find((l) => l.key === key)!.bps!;
    assert.ok(Math.abs(bpsOut - 8.333) < 0.01, `got ${bpsOut}`);
  });

  test('APM FX applies only to the cross-currency share of volume', () => {
    const q = price(
      intake({ monthlyTpv: 3_000_000, vas: { apms: { enabled: true, attachRate: 0.3 } } }),
      book,
      TODAY,
    );
    const fx = q.vasCheck!.lines.find((l) => l.key === 'apm_fx')!;
    assert.equal(fx.amount, 1.99);
    // 1.99% of 30% of volume = 0.597% = 59.7 bps. Against all volume it would read
    // 199 bps, which would swamp the take rate it sits next to.
    assert.ok(Math.abs(fx.bps! - 59.7) < 0.05, `got ${fx.bps}`);
  });
});

describe('Minimum Acceptance Criteria gate', () => {
  test('an MCC that a sector names pins the sector down exactly', () => {
    const q = price(intake({ mcc: '7995', vertical: 'Gambling', region: 'EEA', monthlyTpv: 3_000_000 }), book, TODAY);
    assert.deepEqual(q.macCheck!.sectors.map((s) => s.title), ['Gambling']);
  });

  test('without an MCC every candidate sector for the vertical is offered', () => {
    const q = price(intake({ vertical: 'Crypto', region: 'EEA', monthlyTpv: 3_000_000 }), book, TODAY);
    const titles = q.macCheck!.sectors.map((s) => s.title);
    assert.ok(titles.includes('Cryptocurrency'));
    assert.ok(titles.length > 1, 'a vertical match should offer the rep the candidates');
  });

  test('a deal below its sector eNR floor is flagged, however good the rate', () => {
    // Gambling expects $7.5k monthly net revenue. $1m/month at ~50 bps is ~$5k.
    const q = price(
      intake({ mcc: '7995', vertical: 'Gambling', region: 'EEA', monthlyTpv: 1_000_000, riskLevel: 'HIGH' }),
      book,
      TODAY,
      { requestedBps: 40 },
    );
    assert.equal(q.macCheck!.requiredMonthlyNetRevenueUsd, 7500);
    assert.equal(q.macCheck!.clearsNetRevenue, false);
    assert.ok(q.findings.some((f) => f.code === 'MAC_BELOW_NET_REVENUE'));
  });

  test('the same sector clears at volume', () => {
    const q = price(
      intake({ mcc: '7995', vertical: 'Gambling', region: 'EEA', monthlyTpv: 20_000_000, riskLevel: 'HIGH' }),
      book,
      TODAY,
      { requestedBps: 40 },
    );
    assert.equal(q.macCheck!.clearsNetRevenue, true);
    assert.equal(q.findings.some((f) => f.code === 'MAC_BELOW_NET_REVENUE'), false);
  });

  test('the eNR test uses the requested rate, not guidance, when one is asked for', () => {
    const base = { mcc: '7995', vertical: 'Gambling', region: 'EEA', monthlyTpv: 2_000_000, riskLevel: 'HIGH' as const };
    const atGuidance = price(intake(base), book, TODAY);
    const deeplyCut = price(intake(base), book, TODAY, { requestedBps: 5 });
    assert.ok(atGuidance.macCheck!.monthlyNetRevenueUsd! > deeplyCut.macCheck!.monthlyNetRevenueUsd!);
    assert.equal(deeplyCut.macCheck!.clearsNetRevenue, false);
  });

  test('the strictest floor governs when a merchant sits in two sectors', () => {
    const q = price(intake({ vertical: 'SaaS', region: 'UK', monthlyTpv: 3_000_000 }), book, TODAY);
    const floors = q.macCheck!.sectors.map((s) => s.min_monthly_net_revenue_usd).filter((n): n is number => n != null);
    assert.equal(q.macCheck!.requiredMonthlyNetRevenueUsd, Math.max(...floors));
  });

  test('chargebacks over the MAC ceiling block the deal outright', () => {
    const q = price(
      intake({ mcc: '7995', vertical: 'Gambling', region: 'EEA', monthlyTpv: 20_000_000, chargebackRatioPct: 1.5 }),
      book,
      TODAY,
    );
    assert.equal(q.macCheck!.clearsChargebacks, false);
    assert.equal(q.status, 'BLOCKED');
    assert.ok(q.findings.some((f) => f.code === 'MAC_CHARGEBACKS' && f.level === 'blocking'));
  });

  test('a chargeback ratio between the two thresholds trips the MAC but not the tier', () => {
    // 0.95% is over the MAC's 0.9% submission ceiling and under the frameworks'
    // 1% pricing line. Two documents, two thresholds, and they do not agree.
    const q = price(
      intake({
        mcc: '7995',
        vertical: 'Gambling',
        region: 'EEA',
        monthlyTpv: 20_000_000,
        chargebackRatioPct: 0.95,
        vas: { rtau: { enabled: true, attachRate: 0.05 } },
      }),
      book,
      TODAY,
    );
    assert.equal(q.macCheck!.clearsChargebacks, false);
    // Still 'other' here, but because the merchant is high risk rather than the
    // ratio. A standard-risk merchant at 0.95% would be 'standard'.
    const stdRisk = price(intake({ monthlyTpv: 20_000_000, chargebackRatioPct: 0.95 }), book, TODAY);
    assert.equal(stdRisk.vasCheck!.tier, 'standard');
  });

  test('a merchant with neither MCC nor vertical matches nothing', () => {
    assert.deepEqual(macSectorsFor(book.mac, intake({ mcc: '', vertical: '' })), []);
  });

  test('a hedged MCC list cannot pin a sector on its own', () => {
    // CBD says "Common MCCs used: 5499, 5912, 5977, 5999". 5999 is generic misc
    // retail. Pinning on it would tell a clothing retailer it is selling CBD.
    const cbd = book.mac.sectors.find((s) => s.key === 'cbd')!;
    assert.ok(cbd.mccs.includes('5999'));
    assert.equal(cbd.mccs_exclusive, false);

    const hits = macSectorsFor(book.mac, intake({ mcc: '5999', vertical: 'Retail' }));
    assert.ok(hits.length > 1, 'a hedged MCC must widen to candidates, not narrow to one');
    assert.ok(hits.some((s) => s.key !== 'cbd'));
  });

  test('an unhedged MCC only pins when the vertical agrees with it', () => {
    // 5817 is digital applications, and also how a prop firm books itself when
    // there is no educational element. Two sectors, one MCC.
    const propFirms = book.mac.sectors.find((s) => s.key === 'prop_firms')!;
    assert.ok(propFirms.mccs.includes('5817'));
    assert.equal(propFirms.mccs_exclusive, true);

    // Vertical disagrees -> candidates, so a digital-goods merchant is not handed
    // the prop firm criteria as though we were sure.
    const asDigital = macSectorsFor(book.mac, intake({ mcc: '5817', vertical: 'Digital' }));
    assert.ok(asDigital.length > 1, 'MCC and vertical disagreeing must not pin');
    assert.ok(asDigital.some((s) => s.key === 'prop_firms'), 'but the MCC hit must still be offered');

    // Vertical agrees -> pinned.
    const asBroker = macSectorsFor(book.mac, intake({ mcc: '5817', vertical: 'Brokers/Dealers' }));
    assert.deepEqual(asBroker.map((s) => s.key), ['prop_firms']);
  });

  test('candidate lists are deduplicated and lead with the MCC hit', () => {
    const hits = macSectorsFor(book.mac, intake({ mcc: '5817', vertical: 'Digital' }));
    assert.equal(hits.length, new Set(hits.map((s) => s.key)).size, 'no sector twice');
    assert.equal(hits[0].key, 'prop_firms', 'the MCC hit comes first');
  });

  test('an MCC no sector names falls back to the vertical', () => {
    // 5411 (grocery) is in no MAC sector. The vertical mapping has to carry it, or
    // a Food and Groceries merchant silently escapes every criterion.
    const byUnknownMcc = macSectorsFor(book.mac, intake({ mcc: '5411', vertical: 'Food and Groceries' }));
    const byVertical = macSectorsFor(book.mac, intake({ mcc: '', vertical: 'Food and Groceries' }));
    assert.deepEqual(byUnknownMcc, byVertical);
    assert.ok(byVertical.length > 0);
  });

  test('a merchant the rate card cannot price still gets its MAC criteria', () => {
    const q = price(intake({ region: 'LATAM', vertical: 'Retail', monthlyTpv: 5_000_000 }), book, TODAY);
    assert.equal(q.status, 'UNMAPPED');
    assert.ok(q.macCheck!.sectors.length > 0, 'UNMAPPED must still carry the MAC');
    assert.equal(q.macCheck!.monthlyNetRevenueUsd, null, 'no rate means no net revenue to test');
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

/**
 * The Sales Rep Adjusted Take Rate is what gets approved.
 *
 * The rep builds a rate from core acquiring and value-added services; the tool
 * measures that against guidance and routes on the gap. Nobody types a "requested
 * rate" any more, so these cases pin the wiring: the adjusted total has to reach
 * the approval ladder, and an unpriced deal must not silently route as a 100%
 * discount.
 */
describe('approvals driven by the adjusted take rate', () => {
  const base = { monthlyTpv: 5_000_000, atv: 50 };

  test('the adjusted rate becomes the rate under approval', () => {
    // 0.20% markup = 20 bps of core acquiring, no VAS.
    const q = price(intake({ ...base, acquirerMarkupPct: 0.2 }), book, TODAY, { approveOnAdjusted: true });
    assert.equal(q.adjusted?.totalBps, 20);
    assert.equal(q.requestedBps, 20);
    assert.ok(q.discountPct != null && q.discountPct > 0, 'a rate below guidance is a discount');
    assert.equal(q.approval?.required, true);
  });

  test('an explicitly requested rate still wins over the adjusted one', () => {
    const q = price(intake({ ...base, acquirerMarkupPct: 0.2 }), book, TODAY, {
      approveOnAdjusted: true,
      requestedBps: 35,
    });
    assert.equal(q.requestedBps, 35);
  });

  test('nothing priced means nothing to approve — not a 100% discount', () => {
    const q = price(intake(base), book, TODAY, { approveOnAdjusted: true });
    assert.equal(q.adjusted?.totalBps ?? null, null);
    assert.equal(q.requestedBps, null);
    assert.equal(q.approval, null);
  });

  test('pricing at or above guidance needs no approval on the non-Gold ladder', () => {
    const guidance = price(intake(base), book, TODAY).targetBps!;
    const q = price(intake({ ...base, acquirerMarkupPct: (guidance + 5) / 100 }), book, TODAY, {
      approveOnAdjusted: true,
    });
    assert.ok(q.adjusted!.totalBps! > guidance);
    assert.equal(q.approval?.required, false);
  });

  test('a Gold deal at guidance still needs sign-off', () => {
    const guidance = price(intake(base), book, TODAY).targetBps!;
    const q = price(intake({ ...base, isGold: true, acquirerMarkupPct: guidance / 100 }), book, TODAY, {
      approveOnAdjusted: true,
    });
    assert.equal(q.discountPct, 0);
    assert.equal(q.approval?.required, true);
    assert.deepEqual(
      q.approval!.approvers.map((a) => a.name),
      ['Team Leader', 'Strategic Pricing'],
    );
  });

  test('the MAC is evaluated at the adjusted rate, not at guidance', () => {
    const cheap = price(intake({ ...base, acquirerMarkupPct: 0.02 }), book, TODAY, { approveOnAdjusted: true });
    const atGuidance = price(intake(base), book, TODAY);
    assert.ok(
      (cheap.macCheck?.monthlyNetRevenueUsd ?? 0) < (atGuidance.macCheck?.monthlyNetRevenueUsd ?? 0),
      'a deeply cut adjusted rate produces less net revenue for the MAC test',
    );
  });
});

/**
 * Who the request is addressed to. Roles come from the guidance; the mapping from
 * role to mailbox is an org fact that lives in src/lib/approvers.ts.
 */
describe('approval recipients', () => {
  const matrix = book.approval_matrix;
  const terms = { isGold: false, cashIncentivesUsd: null, freeProcessingMonths: null, vasFreeTrialMonths: null, spException: 'none' as const };

  const route = (discountPct: number, over: Partial<typeof terms> = {}) =>
    routeApproval({ matrix, discountPct, annualBillableTpvUsd: 60_000_000, intake: { ...terms, ...over } });

  test('a non-Gold deal inside 25% goes to the Regional Leader by name', () => {
    const r = resolveRecipient(route(18));
    assert.equal(r?.email, 'ashley.paulus@checkout.com');
    assert.equal(r?.firstName, 'Ashley');
  });

  test('above 25% Strategic Pricing receives it, not the rep', () => {
    const r = resolveRecipient(route(40));
    assert.equal(r?.email, 'strategic.pricing@checkout.com');
  });

  test('every Gold deal routes through Paul Goodwin, whatever the band', () => {
    for (const d of [0, 8, 20, 40, 70]) {
      const r = resolveRecipient(route(d, { isGold: true }));
      assert.equal(r?.email, 'paul.goodwin@checkout.com', `${d}% discount on the Gold ladder`);
    }
  });

  test('no approval means no recipient', () => {
    assert.equal(resolveRecipient(route(-5)), null);
  });
});

describe('the approval email', () => {
  // Guidance for UK Retail at £5m/month is 32 bps. 28 bps of core acquiring is a
  // 12.5% discount, which keeps this inside the Regional Leader band so the draft
  // is addressed to a person rather than escalated to Strategic Pricing.
  const base = { monthlyTpv: 5_000_000, atv: 50, acquirerMarkupPct: 0.28, merchantName: 'Acme Retail', repName: 'Sam' };

  test('greets the recipient and carries both rates and the reduction', () => {
    const i = intake(base);
    const q = price(i, book, TODAY, { approveOnAdjusted: true });
    const draft = buildApprovalEmail(i, q)!;

    assert.ok(draft.body.startsWith('Hey Ashley,'), 'greets by first name');
    assert.match(draft.subject, /^Pricing Approval Request - /);
    assert.ok(draft.body.includes('Recommended Take Rate:'));
    assert.ok(draft.body.includes('Sales Rep Adjusted Take Rate:'));
    assert.ok(draft.body.includes(`${q.adjusted!.totalBps} bps`), 'quotes the adjusted rate');
    assert.ok(draft.body.includes('Main reasons for the request:'));
    assert.ok(draft.body.trimEnd().endsWith('Sam'), 'signs off with the rep');
  });

  test('there is no draft when no approval is required', () => {
    const guidance = price(intake(base), book, TODAY).targetBps!;
    const i = intake({ ...base, acquirerMarkupPct: (guidance + 5) / 100 });
    const q = price(i, book, TODAY, { approveOnAdjusted: true });
    assert.equal(buildApprovalEmail(i, q), null);
  });
});
