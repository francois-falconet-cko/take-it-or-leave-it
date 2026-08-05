/**
 * Demo-only Merchant URL → intake autofill.
 *
 * Paste a known host into Merchant URL (e.g. rebelliousfashion.com) and the
 * matching profile from data/url-autofill.json fills the other merchant fields.
 * No network, no LLM — static JSON only.
 */

import profilesJson from '../../data/url-autofill.json' with { type: 'json' };
import type { Intake } from './types.ts';

export type UrlAutofillFields = Partial<Intake>;

interface Profile {
  id: string;
  hosts: string[];
  fields: UrlAutofillFields;
}

const profiles = profilesJson.profiles as Profile[];

/** Strip protocol, www, path, query — compare hosts only. */
export function normalizeMerchantHost(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  const host = s.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
  return host.replace(/\.$/, '');
}

export function lookupUrlAutofill(rawUrl: string): { id: string; fields: UrlAutofillFields } | null {
  const host = normalizeMerchantHost(rawUrl);
  if (!host) return null;
  for (const p of profiles) {
    const aliases = p.hosts.map(normalizeMerchantHost);
    if (aliases.includes(host)) return { id: p.id, fields: p.fields };
  }
  return null;
}

/** Field keys we mark as auto-filled in the UI (purple chip). */
export function autofillFieldKeys(fields: UrlAutofillFields): string[] {
  return Object.keys(fields).filter((k) => k !== 'verticalOverridden');
}
