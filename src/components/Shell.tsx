'use client';

import Link from 'next/link';
import { BookOpen, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore, type Step } from '@/lib/store';
import { DEMO_MODE, book, bookProblems, oldestSourceDate, staleness } from '@/lib/book';
import { dateLabel } from '@/lib/format';
import { Chip } from './ui/primitives';

const STEPS: { key: Step; label: string }[] = [
  { key: 'intake', label: 'Merchant' },
  { key: 'recommendation', label: 'Guidance' },
  { key: 'challenge', label: 'Accept or challenge' },
  { key: 'deal', label: 'Deal on a page' },
];

export function Shell({ children }: { children: ReactNode }) {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const reset = useStore((s) => s.reset);
  const today = useStore((s) => s.today);
  const reached = STEPS.findIndex((s) => s.key === step);

  const oldest = oldestSourceDate();
  const bookStale = staleness(oldest, today);

  return (
    <div className="min-h-screen bg-surface">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="headline text-[1.0625rem] text-ink">Take it or leave it</span>
            <span className="hidden text-[0.75rem] text-faint lg:inline">
              Front-book pricing on Acquirer Guidance
            </span>
          </div>

          <nav className="ml-2 flex items-center gap-1">
            {STEPS.map((s, i) => {
              const active = s.key === step;
              const visited = i <= reached;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={!visited}
                  onClick={() => setStep(s.key)}
                  className={`rounded-md px-2.5 py-1.5 text-[0.75rem] font-medium transition-colors ${
                    active
                      ? 'bg-blue text-white'
                      : visited
                        ? 'text-muted hover:bg-raised hover:text-ink'
                        : 'text-faint/60'
                  }`}
                >
                  <span className="tnum mr-1.5 opacity-50">{i + 1}</span>
                  {s.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            {DEMO_MODE && (
              <Chip tone="purple" title="Rates are deliberately obfuscated. Set NEXT_PUBLIC_DEMO_MODE=false for real rates.">
                Demo data
              </Chip>
            )}
            <Link
              href="/book"
              className="btn btn-ghost !min-h-8 !px-2.5 !text-[0.75rem]"
              title={`Pricing book ${book.version} · sources last dated ${dateLabel(oldest)}`}
            >
              <BookOpen size={13} />
              <span className="hidden sm:inline">Book</span>
              <span className="chip-mono tnum text-faint">{book.version}</span>
            </Link>
            <button type="button" onClick={reset} className="btn btn-ghost !min-h-8 !px-2.5 !text-[0.75rem]">
              <RotateCcw size={13} />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>
        </div>

        {bookProblems.length > 0 && (
          <Banner tone="danger">
            Pricing book {book.version} failed validation: {bookProblems.join(' ')} Do not quote from it.
          </Banner>
        )}
        {!book.reviewed_by && bookProblems.length === 0 && (
          <Banner tone="warn">
            <strong className="font-semibold">Unapproved pricing book</strong> — {book.version} was compiled but never
            signed off. Not for external quoting. Run <code className="font-mono text-[0.6875rem]">npm run book:approve</code>{' '}
            once the numbers have been checked.
          </Banner>
        )}
        {bookStale === 'stale' && (
          <Banner tone="warn">
            Pricing sources are more than 90 days old (oldest: {dateLabel(oldest)}). Run a refresh before quoting.
          </Banner>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6">{children}</main>
    </div>
  );
}

function Banner({ children, tone }: { children: ReactNode; tone: 'warn' | 'danger' }) {
  return (
    <div
      className={`px-6 py-2 text-[0.75rem] leading-relaxed ${
        tone === 'danger' ? 'bg-orange text-surface' : 'border-t border-orange/30 bg-orange/10 text-orange'
      }`}
    >
      <div className="mx-auto max-w-[1400px]">{children}</div>
    </div>
  );
}
