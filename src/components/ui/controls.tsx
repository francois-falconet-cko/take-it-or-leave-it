'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Touch-first control primitives.
 *
 * House rule for this app: every interactive element is at least 48px on its
 * short axis, and nothing depends on hover — on the Structure A screens there is
 * no cursor, so a hover-only affordance is an invisible one. Hover styles appear
 * only as a bonus for the laptop case.
 */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  accent = 'var(--color-blue-bright)',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed border-line/60 opacity-50'
          : checked
            ? 'border-transparent bg-high'
            : 'border-line bg-raised hover:border-line-strong'
      }`}
      style={{ minHeight: 60, ...(checked && !disabled ? { borderColor: accent } : {}) }}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium text-ink">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">
            {hint}
          </span>
        )}
      </span>

      {/* 52×32 track, 28px knob — comfortably tappable without dominating the row. */}
      <span
        className="relative flex h-8 w-[52px] shrink-0 items-center rounded-full transition-colors duration-200"
        style={{ background: checked && !disabled ? accent : 'var(--color-line-strong)' }}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 550, damping: 32 }}
          className="absolute h-7 w-7 rounded-full bg-white shadow-sm"
          style={{ left: checked ? 22 : 2 }}
        />
      </span>
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Secondary line — endonyms, market names, that sort of thing. */
  sub?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  /** `grid` wraps to two columns; `row` keeps one line and scrolls. */
  variant = 'row',
  accent = 'var(--color-blue-bright)',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  variant?: 'row' | 'grid';
  accent?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={
        variant === 'grid'
          ? 'grid grid-cols-2 gap-2'
          : 'flex gap-1.5 rounded-xl bg-raised p-1.5'
      }
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 text-center transition-colors ${
              opt.disabled
                ? 'cursor-not-allowed text-faint'
                : selected
                  ? 'text-ink'
                  : 'text-muted hover:text-ink'
            } ${variant === 'grid' ? 'border border-line bg-raised' : ''}`}
            style={{
              minHeight: 48,
              ...(selected && variant === 'grid'
                ? { borderColor: accent, background: 'var(--color-high)' }
                : {}),
            }}
          >
            {/* The pill slides between options rather than cross-fading, so the
                eye can follow which one it landed on. */}
            {selected && variant === 'row' && (
              <motion.span
                layoutId={`seg-${ariaLabel}`}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-lg bg-high"
                style={{ boxShadow: `inset 0 0 0 1px ${accent}` }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {Icon && <Icon size={17} strokeWidth={2} />}
              <span className="flex flex-col leading-tight">
                <span className="text-[0.875rem] font-medium">{opt.label}</span>
                {opt.sub && (
                  <span className="text-[0.75rem] font-normal text-muted">
                    {opt.sub}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The small mono caps chip used throughout the brand kit. */
export function MonoChip({
  children,
  color,
  filled = false,
}: {
  children: ReactNode;
  color?: string;
  filled?: boolean;
}) {
  return (
    <span
      className="chip-mono inline-flex items-center rounded-md px-2 py-1"
      style={
        filled
          ? { background: color ?? 'var(--color-blue-bright)', color: '#0B0B0F' }
          : {
              color: color ?? 'var(--color-muted)',
              boxShadow: `inset 0 0 0 1px ${color ?? 'var(--color-line-strong)'}`,
            }
      }
    >
      {children}
    </span>
  );
}

/** A quantified proof point. The brand kit's rule: every demo carries a number. */
export function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-sunken px-4 py-3">
      <div
        className="font-display text-[1.5rem] leading-none font-bold"
        style={{ color: 'var(--color-lime)' }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[0.8125rem] leading-snug text-muted">{label}</div>
    </div>
  );
}

/** Section wrapper: a labelled group of controls inside a narrative section. */
export function ControlGroup({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  /** Slot for a coaching mark badge on the group heading. */
  action?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="chip-mono text-faint">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Non-interactive callout, used for Coming Soon and the multi-PSP note. */
export function Callout({
  title,
  body,
  tag,
  icon: Icon,
}: {
  title: string;
  body: string;
  tag?: string;
  icon?: LucideIcon;
}) {
  return (
    <div
      aria-disabled="true"
      className="rounded-xl border border-dashed border-line-strong bg-raised/60 px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <Icon
            size={18}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-faint"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-medium text-muted">{title}</span>
            {tag && <MonoChip color="var(--color-faint)">{tag}</MonoChip>}
          </div>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-faint">{body}</p>
        </div>
      </div>
    </div>
  );
}

/** Checkbox styled for touch, used in the Remember Me checkbox format. */
export function TouchCheckbox({
  checked,
  onChange,
  children,
  accentColor,
  borderColor,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  accentColor: string;
  borderColor: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 text-left"
      style={{ minHeight: 48, paddingTop: 4, paddingBottom: 4 }}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center transition-colors"
        style={{
          borderRadius: 'min(6px, var(--flow-radius-inner))',
          background: checked ? accentColor : 'transparent',
          boxShadow: `inset 0 0 0 ${checked ? 0 : 1.5}px ${borderColor}`,
        }}
      >
        {checked && (
          <motion.span
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <Check size={15} strokeWidth={3.2} color="var(--flow-inverse)" />
          </motion.span>
        )}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
