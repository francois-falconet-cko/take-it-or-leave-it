/**
 * Checkout.com wordmark.
 *
 * A typographic lockup in the brand display face — not the official logo SVG.
 * The brand kit ships its identity as flattened artwork, so tracing letterforms
 * from it would have produced an approximation that looks wrong next to the real
 * thing on a slide. Setting the name correctly instead is honest, and the one
 * rule that matters here is a writing rule we can follow exactly: capital "C",
 * always ".com", never "CKO", never abbreviated.
 *
 * Drop the real asset at `public/checkout-wordmark.svg` and swap the span for an
 * <img> when one is to hand — nothing else needs to change.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-display font-bold leading-none tracking-[-0.02em] ${className}`}
      // Rendered as one word to a screen reader; the dot-com is not a separate
      // token to be announced.
      aria-label="Checkout.com"
    >
      Checkout.com
    </span>
  );
}

/**
 * Wordmark plus the tool's own name, divided by a hairline. Used in the app
 * header and on the printed Deal on a Page, so the artefact a rep emails to an
 * approver carries the brand rather than arriving as an anonymous table.
 */
export function BrandLockup({
  subject,
  className = '',
  print = false,
}: {
  subject: string;
  className?: string;
  print?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Wordmark className={print ? 'print-ink text-[0.9375rem] text-ink' : 'text-[0.9375rem] text-ink'} />
      {/*
        A border rather than a filled span: print-rule recolours border-color, and
        browsers drop background fills when "print backgrounds" is off — which is
        the default, and the setting nobody changes before hitting Cmd-P.
      */}
      <span
        className={`h-3.5 w-0 shrink-0 border-l border-line-strong ${print ? 'print-rule' : ''}`}
        aria-hidden="true"
      />
      <span className={`chip-mono ${print ? 'print-muted text-muted' : 'text-muted'}`}>{subject}</span>
    </div>
  );
}
