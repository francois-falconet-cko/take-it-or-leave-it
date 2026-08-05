import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

/**
 * Fonts are downloaded at build time and served from this app's own origin, so
 * the demo needs no font CDN at run time. Run `npm run build` while online once;
 * after that the app is fully offline. See RUNBOOK.md.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-face', display: 'swap' });

export const metadata: Metadata = {
  title: 'Take It or Leave It — Front-book pricing · Checkout.com',
  description: 'Acquirer Guidance take rate, approval path, and deal on a page.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#23242B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body className="min-h-full bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
