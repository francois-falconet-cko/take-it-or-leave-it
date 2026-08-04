/**
 * The only code path that may sign off a pricing book.
 *
 * Run: npm run book:approve -- --by "Ad"
 *
 * Compiling is automatic. Approving is not, and deliberately so — the whole
 * governance argument for this tool is that a human reads what changed before any
 * rate becomes quotable. Bumping `reviewed_by` is that human saying so.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const byIndex = args.findIndex((a) => a === '--by');
const by = byIndex >= 0 ? args[byIndex + 1] : undefined;

if (!by) {
  console.error('Who is approving this? Run: npm run book:approve -- --by "Your Name"');
  process.exit(1);
}

for (const file of ['data/pricing-book.json', 'data/pricing-book.demo.json']) {
  const path = resolve(ROOT, file);
  const book = JSON.parse(readFileSync(path, 'utf8'));

  const [day, n] = String(book.version).split('.');
  book.version = `${day}.${Number(n ?? 0) + (book.reviewed_by ? 1 : 0)}${String(book.version).includes('-demo') ? '' : ''}`;
  book.reviewed_by = by;
  book.reviewed_at = process.env.BOOK_APPROVED_AT ?? new Date().toISOString();

  writeFileSync(path, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`${file} — version ${book.version} approved by ${by} at ${book.reviewed_at}`);
}

console.log(`
Approved. The unapproved-book banner will clear on next build.
Re-running \`npm run book:compile\` resets this — approval always follows compilation.`);
