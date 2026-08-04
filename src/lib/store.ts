'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Intake, Quote } from './types.ts';
import { book } from './book.ts';
import { price, verticalForMcc } from './engine/index.ts';

export type Step = 'intake' | 'recommendation' | 'challenge' | 'deal';

export const REASON_FALLBACK = [
  'Competitive Threat',
  'Strategic Account',
  'Volume Commitment',
  'Executive Mandate',
  'Migration / Displacement',
];

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

    vas: Object.fromEntries(
      book.vas_catalogue.map((v) => [v.key, { enabled: false, attachRate: v.default_attach_rate }]),
    ),

    repName: '',
  };
}

interface State {
  step: Step;
  intake: Intake;
  /** Fields the plain-English parser populated, so the UI can mark them. */
  aiFilled: string[];
  /** null until the rep opens the challenge flow. */
  requestedBps: number | null;
  reasonCategory: string;
  justification: string;
  /** Frozen at mount so the pure engine gets a stable `today`. */
  today: string;

  setStep: (s: Step) => void;
  patch: (p: Partial<Intake>) => void;
  setMcc: (mcc: string) => void;
  setVas: (key: string, next: { enabled?: boolean; attachRate?: number }) => void;
  setRequestedBps: (bps: number | null) => void;
  setReason: (category: string, justification: string) => void;
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
      requestedBps: null,
      reasonCategory: '',
      justification: '',
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

      setVas: (key, next) =>
        set((s) => ({
          intake: {
            ...s.intake,
            vas: { ...s.intake.vas, [key]: { ...s.intake.vas[key], ...next } },
          },
        })),

      setRequestedBps: (requestedBps) => set({ requestedBps }),
      setReason: (reasonCategory, justification) => set({ reasonCategory, justification }),
      markAiFilled: (aiFilled) => set({ aiFilled }),

      loadDemo: (partial) =>
        set(() => ({
          intake: { ...emptyIntake(), ...partial },
          step: 'intake',
          requestedBps: null,
          reasonCategory: '',
          justification: '',
          aiFilled: [],
        })),

      reset: () =>
        set({
          intake: emptyIntake(),
          step: 'intake',
          requestedBps: null,
          reasonCategory: '',
          justification: '',
          aiFilled: [],
        }),

    }),
    {
      name: 'tiloi-v1',
      // Surviving a mid-demo refresh matters more than a clean slate.
      partialize: (s) => ({
        step: s.step,
        intake: s.intake,
        requestedBps: s.requestedBps,
        reasonCategory: s.reasonCategory,
        justification: s.justification,
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
  const requestedBps = useStore((s) => s.requestedBps);
  const today = useStore((s) => s.today);
  return useMemo(() => price(intake, book, today, { requestedBps }), [intake, requestedBps, today]);
}

/** Volume fields are the only ones where "" and 0 must not be confused. */
export const numOrNull = (raw: string): number | null => {
  const t = raw.replace(/[, ]/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
