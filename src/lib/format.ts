import type { Currency } from './types.ts';

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

export const sym = (c: string) => SYMBOL[c] ?? `${c} `;

/** Money, rounded to whole units. Deal figures never need cents. */
export function money(value: number | null | undefined, currency: Currency | string = 'USD'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${sym(currency)}${Math.round(value).toLocaleString('en-US')}`;
}

/** Compact money for headline tiles: $1.4m, $850k. */
export function moneyCompact(value: number | null | undefined, currency: Currency | string = 'USD'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const s = sym(currency);
  if (abs >= 1_000_000_000) return `${s}${(value / 1_000_000_000).toFixed(2)}bn`;
  if (abs >= 1_000_000) return `${s}${(value / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${s}${Math.round(value / 1_000)}k`;
  return `${s}${Math.round(value).toLocaleString('en-US')}`;
}

/** Basis points. Trims trailing zeros so 38.4 reads as "38.4" and 30 as "30". */
export function bps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(rounded * 10 % 1 === 0 ? 1 : 2);
}

/** bps as a percentage, the way the framework document writes it. */
export function bpsAsPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value / 100).toFixed(3)}%`;
}

export function pct(value: number | null | undefined, dp = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

export function signedPct(value: number | null | undefined, dp = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '' : value < 0 ? '' : ''}${value.toFixed(dp)}%`;
}

export function int(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * A product framework price, the way its deck prints it: $0.12, 0.20%, 5 bps.
 *
 * No unit suffix — these appear in floor / recommended / ceiling / quoted columns
 * where the header already carries the unit, and repeating "/ txn" four times
 * across a row costs the column width that makes the numbers comparable.
 *
 * Three decimals below a cent because the frameworks genuinely go to $0.005, and
 * rounding that to $0.01 would double it.
 */
export function feeAmount(amount: number | null | undefined, currency: string, unit: string): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  if (unit === 'pct_of_value') return `${amount}%`;
  if (unit === 'bps') return `${amount} bps`;
  return `${sym(currency)}${amount.toFixed(amount < 0.01 ? 3 : 2)}`;
}

/** "$0.01 / txn", "5 bps", "$250 / month" — how the source document says it. */
export function unitLabel(unit: string, amount: number | null, currency: string): string {
  if (amount == null) return 'not extracted';
  const a = amount < 1 ? amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : amount.toLocaleString('en-US');
  switch (unit) {
    case 'bps':
      return `${amount} bps`;
    case 'pct_of_value':
      return `${amount}% of value`;
    case 'per_txn':
      return `${sym(currency)}${a} / txn`;
    case 'per_request':
      return `${sym(currency)}${a} / request`;
    case 'monthly_flat':
      return `${sym(currency)}${a} / month`;
    default:
      return `${sym(currency)}${a}`;
  }
}
