'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { DEMO_MODE, book, bookProblems, daysSince, oldestSourceDate, staleness } from '@/lib/book';
import { dateLabel, int } from '@/lib/format';
import { Card, Chip, ConfidenceChip, StalenessDot, Tile } from '@/components/ui/primitives';
import { BrandLockup } from '@/components/ui/Wordmark';

/**
 * The pricing book, as a screen.
 *
 * Cheap to build and it carries the whole maintainability argument: what version
 * is loaded, which documents it came from, how old each one is, who signed it off,
 * and what the guidance does not cover. A tool that can show this is a different
 * class of thing from one that just prints a number.
 */
export default function BookPage() {
  // Static page — no store, so pick a stable date for staleness display.
  const today = new Date().toISOString().slice(0, 10);
  const oldest = oldestSourceDate();
  const q = book.quality as Record<string, number | string[] | string>;

  const pendingVas = book.vas_catalogue.filter((v) => v.needs_extraction);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="btn btn-ghost !min-h-8 !px-2.5 !text-[0.75rem]">
            <ArrowLeft size={13} />
            Back to pricing
          </Link>
          <BrandLockup subject="Pricing book" className="mt-3" />
          <h1 className="headline mt-2 text-3xl text-ink">Pricing book</h1>
          <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-muted">
            One versioned, human-approved file compiled from every pricing source. The app reads only this — it never
            queries a document at quote time, which is what makes the same merchant produce the same number twice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {DEMO_MODE && <Chip tone="purple">Demo data</Chip>}
          <Chip tone={book.reviewed_by ? 'lime' : 'danger'}>{book.reviewed_by ? 'Approved' : 'Not approved'}</Chip>
        </div>
      </header>

      <div className="space-y-5">
        {bookProblems.length > 0 && (
          <Card className="!border-orange">
            <div className="flex gap-3 p-4">
              <XCircle size={18} className="mt-0.5 shrink-0 text-orange" />
              <div>
                <p className="text-[0.875rem] font-semibold text-orange">Validation failed</p>
                <ul className="mt-1 space-y-0.5 text-[0.8125rem] text-muted">
                  {bookProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}

        <Card title="Status">
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Tile label="Version" value={book.version} />
            <Tile label="Compiled" value={dateLabel(book.generated_at)} sub={book.generated_by} />
            <Tile
              label="Signed off by"
              value={book.reviewed_by ?? 'nobody'}
              tone={book.reviewed_by ? 'lime' : 'orange'}
              sub={book.reviewed_by ? dateLabel(book.reviewed_at) : 'not for external quoting'}
            />
            <Tile
              label="Oldest source"
              value={dateLabel(oldest)}
              tone={staleness(oldest, today) === 'stale' ? 'orange' : 'neutral'}
              sub={`${daysSince(oldest, today) ?? '—'} days old`}
            />
          </div>
          {!book.reviewed_by && (
            <div className="border-t border-line px-5 py-3">
              <p className="text-[0.75rem] leading-relaxed text-muted">
                Nothing merges itself. Check the numbers against the framework, then run{' '}
                <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink">
                  npm run book:approve -- --by &quot;Ad&quot;
                </code>
              </p>
            </div>
          )}
        </Card>

        <Card title="Coverage">
          <div className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Tile label="Framework rows" value={int(book.acquiring.length)} sub={`of ${q.rows_in} in the source`} />
            <Tile label="Regions" value={String(book.dimensions.regions.length)} sub={book.dimensions.regions.join(', ')} />
            <Tile label="Verticals" value={String(book.dimensions.verticals.length)} />
            <Tile label="Volume bands" value={String(book.monthly_tpv_bands_musd.length)} sub="from $1m/month" />
            <Tile label="MCCs mapped" value={String(book.mcc_map.length)} />
            <Tile
              label="Region × vertical gaps"
              value={String(book.coverage_gaps.length)}
              tone={book.coverage_gaps.length === 0 ? 'lime' : 'orange'}
              sub={book.coverage_gaps.length === 0 ? 'full coverage' : undefined}
            />
            <Tile
              label="Rows not reconciling"
              value={String(q.rows_not_reconciling)}
              sub="stated total ≠ components"
            />
            <Tile
              label="Product frameworks"
              value={`${book.vas_catalogue.length - pendingVas.length}/${book.vas_catalogue.length}`}
              tone={pendingVas.length ? 'orange' : 'lime'}
              sub={`${q.vas_prices_verified_against_source} prices verified`}
            />
            <Tile
              label="MAC sectors"
              value={String(book.mac.sectors.length)}
              sub={`${q.mac_sectors_with_net_revenue_floor} with an eNR floor`}
            />
            <Tile label="VAS volume bands" value={String(book.vas_bands.length)} sub="from 500k/month, deal currency" />
          </div>
        </Card>

        <Card
          title="Product pricing frameworks"
          subtitle="One framework per product, banded on monthly volume and tiered Standard or Other MCCs. Every price is checked back against the text of its source document at compile time — a transcription typo fails the build rather than reaching a quote."
          right={
            <span className="chip-mono text-faint">
              {q.vas_prices_verified_against_source as number} prices verified against source
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.8125rem]">
              <thead>
                <tr className="chip-mono text-faint">
                  <th className="px-5 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 font-medium">Document date</th>
                  <th className="px-3 py-2 font-medium">Rules</th>
                  <th className="px-5 py-2 font-medium">Below floor</th>
                </tr>
              </thead>
              <tbody>
                {book.vas_catalogue.map((fw) => (
                  <tr key={fw.key} className="border-t border-line/60">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-ink">{fw.label}</span>
                      {fw.scope && <span className="ml-1.5 text-[0.6875rem] text-faint">{fw.scope}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <ConfidenceChip confidence={fw.confidence} />
                    </td>
                    <td className="px-3 py-2.5 text-right tnum text-muted">{fw.fees.length}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <StalenessDot state={staleness(fw.doc_updated_at, today)} date={fw.doc_updated_at} today={today} />
                        <span className="tnum text-muted">{dateLabel(fw.doc_updated_at)}</span>
                        {fw.doc_updated_at_inferred && (
                          <Chip tone="orange" title={fw.doc_updated_at_note ?? undefined}>
                            inferred
                          </Chip>
                        )}
                        {fw.doc_updated_at == null && fw.doc_extracted_at && (
                          <span
                            className="text-[0.6875rem] text-faint"
                            title={fw.doc_updated_at_note ?? undefined}
                          >
                            extracted {dateLabel(fw.doc_extracted_at)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {fw.mandatory && <Chip tone="lime">mandatory</Chip>}
                        {!fw.free_trials_allowed && <Chip tone="orange">no free trials</Chip>}
                        {fw.pricing_model && <Chip tone="neutral">{fw.pricing_model}</Chip>}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-[0.75rem] text-muted" title={fw.approval_verbatim ?? undefined}>
                      {fw.approval_below_floor.length ? fw.approval_below_floor.join(' → ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-2.5 text-[0.6875rem] leading-relaxed text-faint">
            {book.mcc_tier_rule.verbatim}
          </p>
        </Card>

        <Card
          title="Sources"
          subtitle="Where every number came from. Hover a dot for the document date."
          right={
            <span className="chip-mono text-faint">
              {book.sources.filter((s) => s.retrieved_via !== 'pending').length} of {book.sources.length} retrieved
            </span>
          }
        >
          <table className="w-full text-left text-[0.8125rem]">
            <thead>
              <tr className="chip-mono text-faint">
                <th className="px-5 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">System</th>
                <th className="px-3 py-2 font-medium">Feeds</th>
                <th className="px-3 py-2 font-medium">Document date</th>
                <th className="px-5 py-2 font-medium">Retrieved</th>
              </tr>
            </thead>
            <tbody>
              {book.sources.map((s) => {
                const state = staleness(s.doc_updated_at, today);
                const inferred = (s as unknown as { doc_updated_at_inferred?: boolean }).doc_updated_at_inferred;
                const note = (s as unknown as { doc_updated_at_note?: string }).doc_updated_at_note;
                return (
                  <tr key={s.id} className="border-t border-line/60">
                    <td className="px-5 py-2.5">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink underline decoration-line-strong underline-offset-2 hover:text-blue-bright"
                      >
                        {s.title}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{s.system}</td>
                    <td className="px-3 py-2.5 font-mono text-[0.6875rem] text-faint">{s.feeds}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <StalenessDot state={state} date={s.doc_updated_at} today={today} />
                        <span className="tnum text-muted">{dateLabel(s.doc_updated_at)}</span>
                        {inferred && (
                          <Chip tone="orange" title={note}>
                            inferred
                          </Chip>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      {s.retrieved_via === 'pending' ? (
                        <Chip tone="orange">pending</Chip>
                      ) : (
                        <span className="text-muted">{s.retrieved_via}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card
          title="Known limitations"
          subtitle="What the guidance does not cover, and what this book has not yet extracted. A tool that knows what it does not know is worth more than one that guesses."
        >
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div>
              <h3 className="chip-mono text-faint">Not covered by the guidance</h3>
              <ul className="mt-2 space-y-1 text-[0.8125rem] text-muted">
                {book.approval_matrix.not_covered_by_guidance.map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="text-orange">·</span>
                    {n}
                  </li>
                ))}
                <li className="flex gap-2">
                  <span className="text-orange">·</span>
                  Merchants below $1m monthly volume
                </li>
                <li className="flex gap-2">
                  <span className="text-orange">·</span>
                  Repricing / back book — {book.approval_matrix.reprice_out_of_scope}
                </li>
              </ul>
            </div>
            <div>
              <h3 className="chip-mono text-faint">Products with no framework document</h3>
              <ul className="mt-2 space-y-1 text-[0.8125rem] text-muted">
                {pendingVas.length === 0 && <li className="text-lime">None — every product has its framework.</li>}
                {pendingVas.map((v) => (
                  <li key={v.key} className="flex gap-2">
                    <span className="text-orange">·</span>
                    {v.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-faint">
                These do not affect the guidance take rate — the framework already carries expected VAS revenue in its
                Other line. Without a document there is no banded price, so the attach check leaves them blank rather
                than filling in a plausible number.
              </p>

              {/* The two decks that came through imperfectly. Saying so on the book
                  page is the point: the alternative is a rep discovering it from a
                  merchant. */}
              {book.vas_catalogue.some((v) => v.confidence_note) && (
                <>
                  <h3 className="chip-mono mt-4 text-faint">Extraction caveats</h3>
                  <ul className="mt-2 space-y-1.5 text-[0.75rem] leading-relaxed text-muted">
                    {book.vas_catalogue
                      .filter((v) => v.confidence_note)
                      .map((v) => (
                        <li key={v.key}>
                          <span className="font-medium text-ink">{v.label}</span> — {v.confidence_note}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card title="Compile notes">
          <ul className="space-y-1.5 p-5 text-[0.8125rem] leading-relaxed text-muted">
            {(q.notes as string[]).map((n) => (
              <li key={n} className="flex gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-lime" />
                {n}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Refresh" subtitle="Glean finds the documents, Claude structures them, a human approves the diff.">
          <div className="space-y-3 p-5">
            <ol className="space-y-2 text-[0.8125rem] leading-relaxed text-muted">
              <li>
                <strong className="text-ink">1. Compile</strong> — pull each source, extract candidate rates with a
                verbatim quote and a self-assessed confidence.
              </li>
              <li>
                <strong className="text-ink">2. Diff</strong> — write a plain-English changelog against the committed
                book. Nothing is merged.
              </li>
              <li>
                <strong className="text-ink">3. Approve</strong> — a human reads the diff and signs it off. That is the
                only path that writes to the book.
              </li>
            </ol>
            <div className="space-y-1.5">
              {['npm run book:compile', 'npm run book:approve -- --by "Ad"'].map((cmd) => (
                <code
                  key={cmd}
                  className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[0.6875rem] text-ink"
                >
                  <RefreshCw size={12} className="shrink-0 text-faint" />
                  {cmd}
                </code>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
