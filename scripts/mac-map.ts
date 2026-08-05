/**
 * MAC sector -> Acquirer Framework vertical.
 *
 * The two documents were written by different teams for different purposes and
 * they do not share a taxonomy. The MAC thinks in lines of business a risk officer
 * worries about ("Dropshippers", "Negative Option Subscriptions"); the framework
 * thinks in verticals a rate card is organised by ("Retail", "Digital"). Nothing
 * in either document states the correspondence, so it is written here by hand.
 *
 * This file is committed, unlike the documents themselves — sector names and
 * vertical names are not rates.
 *
 * Rules this map follows:
 *
 *   - A sector maps to every vertical a merchant in it could plausibly be booked
 *     under, not just the most likely one. A false positive costs a rep ten
 *     seconds of reading; a false negative means a deal clears a gate it should
 *     not have.
 *   - Sectors whose MCC list is "Multiple" still map, because the criteria and the
 *     net revenue floor apply regardless of which MCC ends up on the account.
 *   - `[]` means the sector is real but not vertical-scoped. Japan is
 *     country-scoped; the engine matches it on MCC and region instead.
 *
 * Verticals available: Brokers/Dealers, Crypto, Digital, Financial Services /
 * Fintech, Financial Services Misc., Food and Groceries, Gambling, Gaming,
 * Insurance, Mobility, Money Remittance, Professional Services, Retail, SaaS,
 * Travel & Ticketing.
 */

export const MAC_SECTOR_MAP: Record<string, string[]> = {
  CBD: ['Retail', 'Food and Groceries'],
  Cryptocurrency: ['Crypto'],
  'Cryptocurrency On Ramps': ['Crypto', 'Financial Services / Fintech'],
  'Cyberlockers and File Sharing': ['Digital', 'SaaS'],
  'Dating Services': ['Digital'],
  'Debt Repayment': ['Financial Services / Fintech', 'Financial Services Misc.'],
  'Dietary Supplements and Nutraceuticals': ['Retail', 'Food and Groceries'],
  'Digital Goods': ['Digital', 'Gaming', 'SaaS'],
  Dropshippers: ['Retail'],
  'Fantasy Sports & Games of Skill': ['Gaming', 'Gambling'],
  'Furniture and Furnishings': ['Retail'],
  Gambling: ['Gambling'],
  'Gift Cards & Stored Value Vouchers': ['Retail', 'Financial Services Misc.'],
  'Live Streaming': ['Digital'],
  Marketplaces: ['Retail', 'Digital'],
  'Merchant of Record (MOR)': ['SaaS', 'Digital', 'Professional Services'],
  'Money Transfer Services': ['Money Remittance'],
  'Multi-Level Marketing (MLM)': ['Retail', 'Professional Services'],
  'Negative Option Subscriptions': ['Digital', 'SaaS', 'Retail'],
  'Non-Fungible Tokens (NFTs)': ['Crypto', 'Digital'],
  'Payment Facilitators': ['Financial Services / Fintech', 'Financial Services Misc.'],
  Pharmaceuticals: ['Retail'],
  'Prop Firms': ['Brokers/Dealers', 'Financial Services / Fintech'],
  'Security Brokers': ['Brokers/Dealers'],
  'Social Media Management Agencies': ['Professional Services'],
  'Staged Digital Wallet Operators (SDWO)': ['Financial Services / Fintech', 'Financial Services Misc.'],
  'Tickets & Events': ['Travel & Ticketing'],
  'Tobacco Merchants': ['Retail'],
  Travel: ['Travel & Ticketing'],

  // Country-scoped rather than vertical-scoped. Matched on region + MCC.
  'Japan — Country-Specific Guidance': [],
};
