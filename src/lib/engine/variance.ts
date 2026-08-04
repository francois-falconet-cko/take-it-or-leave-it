/**
 * Discount variance and the money that follows from it.
 *
 * The Acquirer Guidance talks in "discount" — up to 25%, 25–50%, over 50% — so
 * that is what this computes: how far below the guidance take rate the requested
 * rate sits, as a percentage of guidance.
 *
 * Sign convention: positive means a discount below guidance. Negative means the
 * rep is pricing above guidance, which needs no one's permission. Getting that
 * backwards routes a premium deal to a leader to chase a signature it does not
 * need, which is exactly the kind of friction this tool exists to remove.
 */

export interface VarianceInput {
  targetBps: number;
  requestedBps: number;
}

/** Discount below guidance, as a percentage of guidance. */
export function discountPct({ targetBps, requestedBps }: VarianceInput): number {
  if (targetBps <= 0) throw new Error('Guidance take rate must be positive to compute a discount');
  return ((targetBps - requestedBps) / targetBps) * 100;
}

export interface MoneyInput {
  billableMonthlyTpv: number;
  targetBps: number;
  requestedBps: number;
}

export interface MoneyOutput {
  /** Net revenue per month at the requested rate. */
  emnrMonthly: number;
  emnrAnnual: number;
  /** Annual net revenue given up versus quoting at guidance. */
  annualRevenueAtRisk: number;
}

export function money({ billableMonthlyTpv, targetBps, requestedBps }: MoneyInput): MoneyOutput {
  const emnrMonthly = billableMonthlyTpv * (requestedBps / 10_000);
  const atGuidanceMonthly = billableMonthlyTpv * (targetBps / 10_000);
  return {
    emnrMonthly,
    emnrAnnual: emnrMonthly * 12,
    annualRevenueAtRisk: (atGuidanceMonthly - emnrMonthly) * 12,
  };
}
