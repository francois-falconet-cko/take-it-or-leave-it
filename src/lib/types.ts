/**
 * Domain types for Take It or Leave It.
 *
 * Two vocabularies meet here and it is worth being precise about which is which:
 *
 *   Acquirer Guidance (the framework)  — speaks in "total take rate", made of
 *   "Acquirer Pay In %" plus "Other". It is a single blended number per
 *   region x vertical x monthly-volume band. This is what approvals measure
 *   against, so it is the target.
 *
 *   Product list pricing (the Highspot one-pagers) — speaks in per-transaction
 *   and per-request fees per product. Useful for checking whether a VAS bundle
 *   plausibly delivers the uplift the framework assumes. NOT the target.
 *
 * Mixing the two is the mistake this file exists to prevent.
 */

export type Currency = 'USD' | 'EUR' | 'GBP';
export type RiskLevel = 'STD' | 'HIGH';
export type FeeUnit = 'bps' | 'per_txn' | 'per_request' | 'monthly_flat' | 'pct_of_value';
export type Confidence = 'high' | 'medium' | 'low' | 'unverified';

// ---------------------------------------------------------------------------
// Pricing book (data/pricing-book.json)
// ---------------------------------------------------------------------------

export interface BookSource {
  id: string;
  title: string;
  system: string;
  url: string;
  doc_updated_at: string | null;
  retrieved_at: string | null;
  retrieved_via: string;
  feeds: string;
}

export interface AcquiringRow {
  id: string;
  region: string;
  vertical: string;
  country_scope: string | null;
  risk_level: 'ALL' | 'STD';
  risk_level_assumed: boolean;
  cat: number;
  monthly_tpv_band_musd: { min: number; max: number | null };
  acquiring_bps: number;
  other_bps: number | null;
  vas_uplift_pct: number | null;
  fx_uplift_pct: number | null;
  /** Authoritative guidance take rate, straight from the framework. */
  total_bps: number;
  reference_atv: number | null;
  high_risk_uplift_pct: number | null;
  high_risk_note: string | null;
  note: string | null;
  reconciles: boolean;
  source_id: string;
  source_locator: string;
  verbatim: string;
  confidence: Confidence;
}

export interface VasCatalogueEntry {
  key: string;
  label: string;
  unit: FeeUnit;
  amount: number | null;
  currency: string;
  default_attach_rate: number;
  attach_rate_note: string;
  source_id: string;
  needs_extraction: boolean;
  confidence: Confidence;
  notes: string;
}

export interface DiscountBand {
  min_pct: number;
  max_pct: number | null;
  approvers: string[];
  managed_by: string | null;
  note: string;
}

export interface ApprovalMatrix {
  source_id: string;
  source_locator: string;
  basis: string;
  discount_bands: { non_gold: DiscountBand[]; gold: DiscountBand[] };
  gold_triggers: { manual_gold_flag: boolean; annual_tpv_usd_gte: number; assumption: string };
  sp_routing_threshold_pct: number;
  sp_routing_note: string;
  qtc_gate: { applies_to: string[]; signatories: string[]; text: string };
  sp_exceptions: string[];
  vas_free_trial_bands: { max_months?: number; min_months?: number; approvers: string[]; note: string }[];
  free_processing_excludes: string[];
  high_risk_uplift_pct: number;
  high_risk_note: string;
  reprice_out_of_scope: string;
  not_covered_by_guidance: string[];
  contact: string;
}

export interface PricingBook {
  version: string;
  generated_at: string;
  generated_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  guidance: {
    name: string;
    effective_from: string;
    take_rate_definition: string;
    volume_basis: string;
    volume_basis_evidence: string;
    band_currency: string;
    scope: string;
  };
  fx: { base: string; as_of: string; rates: Record<string, number>; note: string };
  sources: BookSource[];
  dimensions: { regions: string[]; verticals: string[]; country_scopes: Record<string, string[]> };
  monthly_tpv_bands_musd: { cat: number; min: number; max: number | null }[];
  mcc_map: { mcc: string; label: string; vertical: string; risk_default: 'STD' | 'HIGH' }[];
  acquiring: AcquiringRow[];
  vas_catalogue: VasCatalogueEntry[];
  approval_matrix: ApprovalMatrix;
  coverage_gaps: { region: string; vertical: string; reason: string }[];
  quality: Record<string, unknown>;
  skipped_rows: string[];
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export interface VasSelection {
  enabled: boolean;
  /** Fraction of transactions the fee applies to. 1 = every transaction. */
  attachRate: number;
}

export interface Intake {
  merchantName: string;
  merchantUrl: string;
  mcc: string;
  vertical: string;
  verticalOverridden: boolean;
  region: string;
  countryScope: string | null;
  riskLevel: RiskLevel;
  currentAcceptanceRate: number | null;
  platform: string;
  currentProviders: string;

  currency: Currency;
  atv: number | null;
  monthlyTpv: number | null;
  threeMonthTpv: number | null;
  annualTpv: number | null;
  /** Share of the merchant's volume Checkout.com will actually process. */
  scopePct: number;
  scopeNote: string;
  contractTerm: string;
  mmb: number | null;

  /** Gold account. Drives a different approval ladder entirely. */
  isGold: boolean;
  cashIncentivesUsd: number | null;
  freeProcessingMonths: number | null;
  vasFreeTrialMonths: number | null;
  spException: 'none' | 'new_entity_only' | 'minor_adjustment_le_5pct';

  vas: Record<string, VasSelection>;

  repName: string;
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export type FindingLevel = 'blocking' | 'warning' | 'info';

export interface Finding {
  level: FindingLevel;
  code: string;
  message: string;
  detail?: string;
}

/** One row of the guidance decomposition. Carries its own provenance. */
export interface PriceLine {
  key: string;
  label: string;
  category: 'acquiring' | 'other' | 'uplift' | 'rounding';
  bps: number;
  /** How the source document expresses it, for the "as quoted" column. */
  asQuoted: string;
  sourceId: string;
  sourceLocator: string;
  verbatim: string;
  confidence: Confidence;
  docUpdatedAt: string | null;
}

/** Product list pricing rolled up to bps, for the attach-check panel only. */
export interface VasLine {
  key: string;
  label: string;
  unit: FeeUnit;
  amount: number | null;
  currency: string;
  attachRate: number;
  bps: number | null;
  needsExtraction: boolean;
  confidence: Confidence;
  sourceId: string;
  notes: string;
}

export interface VasCheck {
  /** bps the framework assumes will come from VAS + FX, i.e. the "Other" line. */
  frameworkOtherBps: number;
  /** bps the selected product list prices actually add up to. */
  selectedListPriceBps: number | null;
  /** null when any selected VAS still needs extraction. */
  deltaBps: number | null;
  anyUnverified: boolean;
  lines: VasLine[];
}

export interface ApproverRequirement {
  name: string;
  reason: string;
}

export interface ApprovalOutcome {
  required: boolean;
  track: 'non_gold' | 'gold';
  goldReason: string | null;
  bandNote: string | null;
  approvers: ApproverRequirement[];
  managedBy: string | null;
  /** Above the SP routing threshold the rep does not send the email — SP does. */
  emailOwner: 'rep' | 'Strategic Pricing';
  qtcGate: { signatories: string[]; text: string } | null;
  spExceptionApplied: string | null;
  sideTracks: { label: string; approvers: string[]; note: string }[];
  notes: string[];
}

export interface BandPlacement {
  cat: number;
  min: number;
  max: number | null;
  /** Band the merchant's TOTAL volume would sit in, when scope < 100%. */
  catOnTotalVolume: number | null;
}

export interface Quote {
  status: 'OK' | 'UNMAPPED' | 'BLOCKED';
  findings: Finding[];

  effectiveMonthlyTpv: number | null;
  effectiveMonthlyTpvSource: 'monthly' | 'three_month' | 'annual' | null;
  billableMonthlyTpv: number | null;
  billableMonthlyTpvUsd: number | null;
  monthlyTxns: number | null;
  band: BandPlacement | null;

  match: AcquiringRow | null;
  lines: PriceLine[];
  targetBps: number | null;

  requestedBps: number | null;
  discountPct: number | null;
  annualRevenueAtRisk: number | null;
  emnrMonthly: number | null;
  emnrAnnual: number | null;
  mmbImpliedFloorBps: number | null;
  mmbBinds: boolean;

  approval: ApprovalOutcome | null;
  vasCheck: VasCheck | null;

  /** Adjacent rows shown when status is UNMAPPED. Explicitly not guidance. */
  nearest: AcquiringRow[];
  searchedFor: Record<string, string> | null;
}
