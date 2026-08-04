#!/usr/bin/env node
/**
 * Builds need `data/pricing-book.json` on disk even when DEMO_MODE is on —
 * both books are imported statically so the bundler resolves both paths.
 *
 * The real book is gitignored. If it is missing (fresh clone, CI, Docker),
 * copy the demo book into place so the build can proceed. Real rates still
 * require `npm run book:compile` (or an approved book drop-in) before setting
 * NEXT_PUBLIC_DEMO_MODE=false.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = join(root, 'data', 'pricing-book.json');
const demo = join(root, 'data', 'pricing-book.demo.json');

if (existsSync(real)) {
  process.exit(0);
}

if (!existsSync(demo)) {
  console.error('Missing data/pricing-book.demo.json — cannot stub the live book.');
  process.exit(1);
}

copyFileSync(demo, real);
console.warn(
  'data/pricing-book.json was missing; copied from pricing-book.demo.json.\n' +
    '  Demo rates only. For real rates: npm run book:compile, then set NEXT_PUBLIC_DEMO_MODE=false.',
);
