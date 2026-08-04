/**
 * The one runtime LLM call: plain English -> structured intake fields.
 *
 * Hard boundary, and it is the whole reason this is a separate route rather than
 * something the pricing engine reaches for: this endpoint may fill in merchant
 * facts and nothing else. It never sees the pricing book, never returns a rate,
 * a bps figure, or an approver, and its output is stripped to an allow-list of
 * fields before it reaches the client.
 *
 * With no ANTHROPIC_API_KEY set it returns 503 and the UI falls back to manual
 * entry. The demo must never depend on this route.
 */

import { NextResponse } from 'next/server';
import bookJson from '../../../data/pricing-book.json' with { type: 'json' };

const MODEL = 'claude-sonnet-5';

/** Only these fields may come back. Anything else is dropped. */
const ALLOWED = [
  'merchantName',
  'merchantUrl',
  'mcc',
  'vertical',
  'region',
  'countryScope',
  'riskLevel',
  'platform',
  'currentProviders',
  'currentAcceptanceRate',
  'currency',
  'atv',
  'monthlyTpv',
  'annualTpv',
  'scopePct',
  'scopeNote',
  'contractTerm',
  'mmb',
  'isGold',
] as const;

const NUMERIC = new Set(['currentAcceptanceRate', 'atv', 'monthlyTpv', 'annualTpv', 'scopePct', 'mmb']);

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not set. Enter the fields manually — the pricing engine does not need this.' },
      { status: 503 },
    );
  }

  let text = '';
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length < 10) {
    return NextResponse.json({ error: 'Give me a sentence or two to work with.' }, { status: 400 });
  }

  const verticals = bookJson.dimensions.verticals;
  const regions = bookJson.dimensions.regions;

  const tool = {
    name: 'merchant_fields',
    description: 'Structured merchant facts extracted from the description.',
    input_schema: {
      type: 'object' as const,
      properties: {
        merchantName: { type: 'string' },
        merchantUrl: { type: 'string' },
        mcc: { type: 'string', description: '4-digit MCC. Only if stated or unambiguous from the business type.' },
        vertical: { type: 'string', enum: verticals },
        region: { type: 'string', enum: [...regions, 'LATAM'] },
        countryScope: { type: 'string', description: 'Only if a country-specific scope is named.' },
        riskLevel: { type: 'string', enum: ['STD', 'HIGH'] },
        platform: { type: 'string' },
        currentProviders: { type: 'string' },
        currentAcceptanceRate: { type: 'number' },
        currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
        atv: { type: 'number', description: 'Average transaction value in the deal currency.' },
        monthlyTpv: { type: 'number', description: 'Monthly processing volume in the deal currency, absolute units.' },
        annualTpv: { type: 'number' },
        scopePct: { type: 'number', description: 'Percent of the merchant volume Checkout.com would process. 100 if not stated.' },
        scopeNote: { type: 'string' },
        contractTerm: { type: 'string' },
        mmb: { type: 'number', description: 'Monthly Minimum Bill.' },
        isGold: { type: 'boolean' },
      },
      required: [],
    },
  };

  const system = [
    'You extract merchant facts from a sales rep\'s free-text description of a payments deal.',
    '',
    'Rules:',
    '- Only return fields the text actually supports. Omit anything not stated or not clearly implied. Do not fill gaps with plausible defaults.',
    '- Volumes are absolute units, not millions: "£4m a month" is 4000000.',
    '- "TPV" means total processing volume.',
    '- Never output a take rate, a basis-point figure, a price, a discount, or an approver. You do not price deals; another system does that from an approved rate card.',
    `- vertical must be one of: ${verticals.join(', ')}.`,
    `- region must be one of: ${regions.join(', ')}, LATAM. Map "Europe"/"EU"/"EEA" to EEA, "US"/"USA"/"North America" to NORAM, "Middle East" to MENA, "United Kingdom" to UK.`,
    '- riskLevel HIGH only for genuinely high-risk businesses: crypto, gambling, money remittance, adult.',
    '',
    'Call merchant_fields exactly once.',
  ].join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'merchant_fields' },
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: `Claude returned ${res.status}. ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const block = (json.content ?? []).find((c: { type: string }) => c.type === 'tool_use');
    if (!block) return NextResponse.json({ error: 'No structured output returned.' }, { status: 502 });

    // Allow-list, coerce, drop empties. Belt and braces: even a compromised or
    // confused model response cannot introduce a rate into the intake.
    const fields: Record<string, unknown> = {};
    for (const k of ALLOWED) {
      const v = (block.input as Record<string, unknown>)[k];
      if (v == null || v === '') continue;
      if (NUMERIC.has(k)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        fields[k] = n;
      } else {
        fields[k] = v;
      }
    }
    if (fields.vertical) fields.verticalOverridden = true;

    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Network error reaching Claude.' },
      { status: 502 },
    );
  }
}
