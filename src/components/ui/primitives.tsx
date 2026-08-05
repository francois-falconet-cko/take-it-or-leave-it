'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Info, ShieldAlert } from 'lucide-react';
import type { Confidence, Finding } from '@/lib/types';
import { dateLabel } from '@/lib/format';
import { daysSince, sourceById, type Staleness } from '@/lib/book';

export function Field({
  label,
  hint,
  children,
  required,
  aiFilled,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
  aiFilled?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label flex items-center gap-1.5">
        {label}
        {required && <span className="text-orange">*</span>}
        {aiFilled && <span className="chip-mono text-purple">AI</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[0.6875rem] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  aiFilled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  aiFilled?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      className="field"
      value={value}
      placeholder={placeholder}
      data-ai-filled={aiFilled ? 'true' : undefined}
      data-invalid={invalid ? 'true' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Numeric input, deliberately `type="text"` with `inputMode="decimal"`.
 *
 * `type="number"` renders its value through the browser locale, so on a French
 * machine 33.25 displays as "33,25" — which in a pricing tool reads as a bug and
 * costs you the room. Holding the raw text locally also lets someone type "33."
 * or "33," without the value snapping out from under them mid-keystroke.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  aiFilled,
  invalid,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  aiFilled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));

  // Re-sync only when the outside value genuinely differs from what is typed, so
  // a demo-merchant load lands but an in-progress keystroke is left alone.
  useEffect(() => {
    const typed = text.replace(',', '.').trim();
    const same = typed === '' ? value == null : Number(typed) === value;
    if (!same) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="relative flex items-center">
      {prefix && <span className="pointer-events-none absolute left-3 text-sm tnum text-faint">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        className="field tnum"
        style={{
          paddingLeft: prefix ? `${prefix.length * 0.55 + 1}rem` : undefined,
          paddingRight: suffix ? '2.5rem' : undefined,
        }}
        value={text}
        placeholder={placeholder}
        data-ai-filled={aiFilled ? 'true' : undefined}
        data-invalid={invalid ? 'true' : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          // Digits, one separator, optional leading minus. Accept a comma as the
          // decimal mark, since a French keyboard puts it under the thumb.
          if (!/^-?[\d]*[.,]?[\d]*$/.test(raw)) return;
          setText(raw);
          const t = raw.replace(',', '.').trim();
          if (t === '' || t === '-' || t === '.') return onChange(null);
          const n = Number(t);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-sm text-faint">{suffix}</span>}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  aiFilled,
}: {
  value: T | '';
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
  aiFilled?: boolean;
}) {
  return (
    <select
      className="field"
      value={value}
      data-ai-filled={aiFilled ? 'true' : undefined}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'blue' | 'lime' | 'orange' | 'purple' | 'danger';
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-high text-muted',
    blue: 'bg-blue-bright/15 text-blue-bright',
    lime: 'bg-lime/15 text-lime',
    orange: 'bg-orange/15 text-orange',
    purple: 'bg-purple/20 text-purple',
    danger: 'bg-orange text-surface',
  };
  return (
    // nowrap because a chip is a label, not prose: wrapping "medium confidence"
    // onto two lines pushes the text straight out of its own pill.
    <span
      title={title}
      className={`chip-mono inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = '',
  title,
  subtitle,
  right,
}: {
  children?: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <section className={`print-card rounded-xl border border-line bg-raised ${className}`}>
      {(title || right) && (
        <header className="print-rule flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="chip-mono print-muted text-muted">{title}</h2>}
            {subtitle && <p className="print-muted mt-1 text-[0.8125rem] leading-snug text-faint">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone = 'neutral',
  big,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'lime' | 'orange' | 'blue';
  big?: boolean;
}) {
  const colors: Record<string, string> = {
    neutral: 'text-ink',
    lime: 'text-lime',
    orange: 'text-orange',
    blue: 'text-blue-bright',
  };
  return (
    <div>
      <div className="chip-mono print-muted text-faint">{label}</div>
      <div
        className={`print-ink mt-1 tnum font-display font-bold leading-none ${colors[tone]} ${big ? 'text-4xl' : 'text-2xl'}`}
      >
        {value}
      </div>
      {sub && <div className="print-muted mt-1 text-[0.75rem] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

const STALE_TONE: Record<Staleness, { color: string; label: string }> = {
  fresh: { color: 'var(--color-lime)', label: 'Up to date' },
  ageing: { color: '#e8c33a', label: '31–90 days old' },
  stale: { color: 'var(--color-orange)', label: 'Over 90 days old — refresh before quoting' },
  unknown: { color: 'var(--color-faint)', label: 'Document date unknown' },
};

export function StalenessDot({ state, date, today }: { state: Staleness; date: string | null; today: string }) {
  const t = STALE_TONE[state];
  const days = daysSince(date, today);
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full align-middle"
      style={{ background: t.color }}
      title={`${t.label}${date ? ` · ${dateLabel(date)}${days != null ? ` (${days} days)` : ''}` : ''}`}
    />
  );
}

const CONFIDENCE_TONE: Record<Confidence, 'lime' | 'blue' | 'orange' | 'danger'> = {
  high: 'lime',
  medium: 'blue',
  low: 'orange',
  unverified: 'danger',
};

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  // Spelled out: a bare "HIGH" next to a risk-level badge reads as "high risk".
  return (
    <Chip tone={CONFIDENCE_TONE[confidence]} title="How much to trust this extraction from the source document">
      {confidence} confidence
    </Chip>
  );
}

/**
 * Provenance. Every rate on screen has one of these next to it — the whole
 * trust argument for the tool rests on being able to click a number and land on
 * the document it came from.
 */
export function SourceLink({
  sourceId,
  locator,
  verbatim,
  today,
}: {
  sourceId: string;
  locator: string;
  verbatim?: string;
  today: string;
}) {
  const src = sourceById(sourceId);
  if (!src) return <span className="text-faint">unknown source</span>;
  const state = ((): Staleness => {
    const d = daysSince(src.doc_updated_at, today);
    if (d == null) return 'unknown';
    return d <= 30 ? 'fresh' : d <= 90 ? 'ageing' : 'stale';
  })();

  return (
    <span className="group/src inline-flex items-baseline gap-1.5">
      <StalenessDot state={state} date={src.doc_updated_at} today={today} />
      <a
        href={src.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-baseline gap-1 text-[0.75rem] text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-blue-bright hover:decoration-blue-bright"
        title={[src.title, locator, verbatim && `“${verbatim}”`].filter(Boolean).join('\n')}
      >
        {src.system}
        <ExternalLink size={10} className="no-print shrink-0 opacity-60" />
      </a>
      <span className="print-muted text-[0.6875rem] text-faint">{locator}</span>
    </span>
  );
}

const FINDING_ICON = { blocking: ShieldAlert, warning: AlertTriangle, info: Info } as const;
const FINDING_STYLE = {
  blocking: 'border-orange/60 bg-orange/10 text-orange',
  warning: 'border-orange/35 bg-orange/[0.06] text-orange',
  info: 'border-line bg-sunken text-muted',
} as const;

export function FindingRow({ finding }: { finding: Finding }) {
  const Icon = FINDING_ICON[finding.level];
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 ${FINDING_STYLE[finding.level]}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium leading-snug">{finding.message}</p>
        {finding.detail && (
          <p className="mt-1 text-[0.75rem] leading-relaxed text-muted print-muted">{finding.detail}</p>
        )}
      </div>
    </div>
  );
}

/** Already shown as a persistent banner in the header — don't say it twice. */
const SUPPRESSED = new Set(['BOOK_UNAPPROVED']);

export function FindingList({ findings, levels }: { findings: Finding[]; levels?: Finding['level'][] }) {
  const shown = findings
    .filter((f) => !SUPPRESSED.has(f.code))
    .filter((f) => !levels || levels.includes(f.level));
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2">
      {shown.map((f, i) => (
        <FindingRow key={`${f.code}-${i}`} finding={f} />
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  accent = 'var(--color-blue-bright)',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        checked ? 'bg-high' : 'border-line bg-sunken hover:border-line-strong'
      }`}
      style={checked ? { borderColor: accent } : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[0.6875rem] leading-snug text-faint">{hint}</span>}
      </span>
      <span
        className="relative flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200"
        style={{ background: checked ? accent : 'var(--color-line-strong)' }}
      >
        <span
          className="absolute h-3.5 w-3.5 rounded-full bg-ink transition-transform duration-200"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(3px)' }}
        />
      </span>
    </button>
  );
}
