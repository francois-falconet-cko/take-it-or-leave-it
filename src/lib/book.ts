/**
 * Pricing book loading.
 *
 * The book is imported statically so it ends up in the bundle: no fetch, no
 * filesystem read at request time, and the app works with the network off.
 *
 * DEMO_MODE decides which book loads. It defaults to ON so that a live demo, a
 * screen recording, or a screenshot never leaks real rates by accident — someone
 * has to deliberately set NEXT_PUBLIC_DEMO_MODE=false to see them.
 */

import bookJson from '../../data/pricing-book.json' with { type: 'json' };
import demoJson from '../../data/pricing-book.demo.json' with { type: 'json' };
import type { PricingBook } from './types.ts';

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

export const book = (DEMO_MODE ? demoJson : bookJson) as unknown as PricingBook;

/** Structural checks. Cheap, and they turn a confusing blank screen into a message. */
export function validateBook(b: PricingBook): string[] {
  const problems: string[] = [];
  if (!b.version) problems.push('Book has no version.');
  if (!Array.isArray(b.acquiring) || b.acquiring.length === 0) problems.push('Book has no acquiring rows.');
  if (!b.approval_matrix?.discount_bands?.non_gold?.length) problems.push('Book has no non-Gold discount bands.');
  if (!b.approval_matrix?.discount_bands?.gold?.length) problems.push('Book has no Gold discount bands.');
  if (!b.fx?.rates?.USD) problems.push('Book has no USD FX rate.');
  for (const r of b.acquiring) {
    if (!(r.total_bps > 0)) {
      problems.push(`Row ${r.id} has a non-positive total take rate.`);
      break;
    }
  }
  return problems;
}

export const bookProblems = validateBook(book);

export const sourceById = (id: string) => book.sources.find((s) => s.id === id) ?? null;

/** Oldest document date across sources we actually have — drives the staleness banner. */
export function oldestSourceDate(b: PricingBook = book): string | null {
  const dates = b.sources.map((s) => s.doc_updated_at).filter((d): d is string => !!d);
  return dates.length ? dates.sort()[0] : null;
}

export function daysSince(date: string | null, today: string): number | null {
  if (!date) return null;
  return Math.floor((Date.parse(today) - Date.parse(date)) / 86_400_000);
}

export type Staleness = 'fresh' | 'ageing' | 'stale' | 'unknown';

export function staleness(date: string | null, today: string): Staleness {
  const days = daysSince(date, today);
  if (days == null) return 'unknown';
  if (days <= 30) return 'fresh';
  if (days <= 90) return 'ageing';
  return 'stale';
}
