'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Intake, Quote, VasFeeSelection } from './types.ts';
import { book } from './book.ts';
import { price, primaryFee, verticalForMcc } from './engine/index.ts';

/**
 * Two working steps, then the artefact.
 *
 * The old flow had the rep price the deal, then separately name a rate to
 * challenge with. The rate they build from core acquiring and VAS *is* the rate
 * under approval now, so there is nothing left to choose on a middle screen —
 * intake goes straight to the approval path.
 */
export type Step = 'intake' | 'approval' | 'deal';

export function emptyIntake(): Intake {
  return {
    merchantName: '',
    merchantUrl: '',
    mcc: '',
    vertical: '',
    verticalOverridden: false,
    region: 'UK',
    countryScope: null,
    riskLevel: 'STD',
    chargebackRatioPct: null,
    currentAcceptanceRate: null,
    platform: '',
    currentProviders: '',

    currency: 'GBP',
    atv: null,
    monthlyTpv: null,
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

    // Attach rate comes off the framework's primary fee. The quoted amount stays
    // undefined so the engine prices at the framework recommendation until the rep
    // deliberately types something else.
    vas: Object.fromEntries(
      book.vas_catalogue.map((v) => [v.key, { enabled: false, attachRate: primaryFee(v)?.default_attach_rate ?? 1 }]),
    ),
    activeSellers: null,

    // Core acquiring starts empty rather than at a plausible default: the adjusted
    // rate is meant to reflect what the rep has actually decided to charge.
    acquirerMarkupPct: null,
    gatewayFee: null,
    gatewayFeeCurrency: 'GBP',

    repName: '',
  };
}

interface State {
  step: Step;
  intake: Intake;
  /** Fields the plain-English parser populated, so the UI can mark them. */
  aiFilled: string[];
  /** Frozen at mount so the pure engine gets a stable `today`. */
  today: string;

  setStep: (s: Step) => void;
  patch: (p: Partial<Intake>) => void;
  setMcc: (mcc: string) => void;
  setVas: (key: string, next: { enabled?: boolean; attachRate?: number; quotedAmount?: number | null }) => void;
  /** Override one fee inside a multi-fee framework — Integrated Platforms, APMs. */
  setVasFee: (key: string, feeKey: string, next: VasFeeSelection) => void;
  markAiFilled: (fields: string[]) => void;
  loadDemo: (intake: Partial<Intake>) => void;
  reset: () => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      step: 'intake',
      intake: emptyIntake(),
      aiFilled: [],
      today: new Date().toISOString().slice(0, 10),

      setStep: (step) => set({ step }),

      patch: (p) => set((s) => ({ intake: { ...s.intake, ...p } })),

      /**
       * Setting an MCC resolves the vertical and the default risk tier — unless the
       * rep has already overridden the vertical by hand, in which case their choice
       * wins. Silently reverting a manual override is the kind of small betrayal
       * that makes people stop trusting a form.
       */
      setMcc: (mcc) =>
        set((s) => {
          const hit = verticalForMcc(book, mcc);
          if (!hit || s.intake.verticalOverridden) return { intake: { ...s.intake, mcc } };
          return {
            intake: {
              ...s.intake,
              mcc,
              vertical: hit.vertical,
              riskLevel: hit.risk_default === 'HIGH' ? 'HIGH' : s.intake.riskLevel,
            },
          };
        }),

      // A deal loaded from a demo file may have no entry for a product at all, so
      // the framework's own default attach rate is the fallback rather than 0.
      setVas: (key, next) =>
        set((s) => {
          const fallback = {
            enabled: false,
            attachRate: primaryFee(book.vas_catalogue.find((v) => v.key === key)!)?.default_attach_rate ?? 1,
          };
          return {
            intake: {
              ...s.intake,
              vas: { ...s.intake.vas, [key]: { ...fallback, ...s.intake.vas[key], ...next } },
            },
          };
        }),

      setVasFee: (key, feeKey, next) =>
        set((s) => {
          const current = s.intake.vas[key] ?? { enabled: false, attachRate: 1 };
          return {
            intake: {
              ...s.intake,
              vas: {
                ...s.intake.vas,
                [key]: {
                  ...current,
                  fees: { ...current.fees, [feeKey]: { ...current.fees?.[feeKey], ...next } },
                },
              },
            },
          };
        }),

      markAiFilled: (aiFilled) => set({ aiFilled }),

      loadDemo: (partial) =>
        set(() => ({
          intake: { ...emptyIntake(), ...partial },
          step: 'intake',
          aiFilled: [],
        })),

      reset: () =>
        set({
          intake: emptyIntake(),
          step: 'intake',
          aiFilled: [],
        }),

    }),
    {
      // Bumped when the accept/challenge fork was replaced by a single approval
      // step. A session persisted under v2 carries step: 'recommendation' or
      // 'challenge', which no longer resolve to a screen.
      name: 'tiloi-v3',
      // Surviving a mid-demo refresh matters more than a clean slate.
      partialize: (s) => ({
        step: s.step,
        intake: s.intake,
        aiFilled: s.aiFilled,
      }),
    },
  ),
);

/**
 * The quote, memoized.
 *
 * Deliberately NOT a zustand selector: `price()` returns a fresh object every
 * call, so a selector like `useStore(s => s.quote())` hands React a new snapshot
 * on every render and spins forever. Reading the primitive slices and memoizing
 * on them is the fix, and it also means the engine runs once per input change
 * rather than once per render.
 */
export function useQuote(): Quote {
  const intake = useStore((s) => s.intake);
  const today = useStore((s) => s.today);
  // approveOnAdjusted: the rate the rep built from core acquiring + VAS is the
  // rate under approval. The engine still accepts an explicit `requestedBps` for
  // tests and scripts; the app never pins one.
  return useMemo(() => price(intake, book, today, { approveOnAdjusted: true }), [intake, today]);
}

/** Volume fields are the only ones where "" and 0 must not be confused. */
export const numOrNull = (raw: string): number | null => {
  const t = raw.replace(/[, ]/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
