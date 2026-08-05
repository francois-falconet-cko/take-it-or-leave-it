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

/**
 * Every product pricing framework splits merchants two ways, in identical words:
 * "Other" is a chargeback ratio above 1% or a Restricted/High CKO risk rating,
 * "Standard" is everything else. Other costs the merchant more, on every product.
 *
 * This is NOT the same axis as the acquiring framework's STD/ALL risk level, which
 * is about whether a vertical is priced as high-risk at all. A Gambling merchant
 * with clean chargebacks is `ALL` on the acquiring row and `other` here.
 */
export type MccTier = 'standard' | 'other';

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

/**
 * Volume band on a product pricing framework.
 *
 * Deliberately a different ladder from `monthly_tpv_bands_musd`: the product
 * frameworks run 500k / 1m / 2m / 5m / 10m / 20m, where acquiring guidance runs
 * 1m / 2.5m / 5m / 10m / 25m / … A merchant at $3m/month is Cat 2 for acquiring
 * and band index 2 for VAS, and those are not the same fact.
 *
 * `min`/`max` are in millions of the DEAL currency, not USD. The frameworks print
 * one number under "Monthly Processing Volume ($/£/€)", so the bands are read in
 * whatever the merchant is billed in.
 */
export interface VasVolumeBand {
  index: number;
  min: number;
  max: number | null;
  label: string;
}

/** Recommended / floor / ceiling for one fee, one MCC tier, across all bands. */
export interface VasTierPrices {
  recommended: (number | null)[];
  floor: (number | null)[];
  ceiling: (number | null)[];
}

/**
 * How a fee's amount becomes basis points.
 *
 * `unmodelled` is not a gap in the code — it is a fee whose driver this tool does
 * not collect (payout count, internal transfer volume). Its rate is still carried
 * and shown so the rep can price it by hand; it just contributes no bps.
 */
export type VasFeeDriver = 'attached_transactions' | 'volume_share' | 'per_seller_month' | 'unmodelled';

export interface VasFee {
  key: string;
  label: string;
  unit: FeeUnit;
  /** 'LOCAL' when the framework prints one number for $/£/€ — no FX conversion. */
  currency: string;
  basis: string;
  driver: VasFeeDriver;
  default_attach_rate: number;
  attach_rate_note: string;
  not_modelled_reason: string | null;
  verbatim: string;
  /** Band index from which the floor is "Waived" rather than a number. */
  floor_waived_from_band?: number;
  /** null when no framework has been supplied for the product. */
  tiers: { standard: VasTierPrices; other: VasTierPrices } | null;
}

/**
 * One product pricing framework, banded and tiered.
 *
 * Replaces the old flat `VasCatalogueEntry`, which carried a single placeholder
 * amount per product. A single amount cannot express any of these frameworks: the
 * price moves with volume band, with MCC tier, and it has a floor and a ceiling
 * that carry their own approval requirements.
 */
export interface VasFramework {
  key: string;
  label: string;
  source_id: string;
  source_locator: string;
  doc_updated_at: string | null;
  doc_updated_at_inferred: boolean;
  doc_updated_at_note: string | null;
  /** When the PDF was converted to markdown. Real date even where the deck is undated. */
  doc_extracted_at: string | null;
  confidence: Confidence;
  confidence_note: string | null;
  pricing_model: string | null;
  /** "Pricing for X is mandatory" — the deck's words. Not selling it is a finding. */
  mandatory: boolean;
  free_trials_allowed: boolean;
  approval_below_floor: string[];
  approval_above_ceiling: string[];
  approval_verbatim: string | null;
  /** Regions the framework covers, when it says. null means it does not restrict. */
  scope: string | null;
  needs_extraction: boolean;
  blended_uplift: {
    note: string;
    scheme_fees: { scheme: string; basis: string; amount: number; currency: string }[];
  } | null;
  notes: string[];
  fees: VasFee[];
  /** APM per-method reference rates. Display only — the method mix is not modelled. */
  reference_methods?: Record<string, string | boolean | null>[];
}

// ---------------------------------------------------------------------------
// Minimum Acceptance Criteria
// ---------------------------------------------------------------------------

/**
 * MAC is not pricing, which is the point. It sets the floor under the pricing
 * conversation: a sector's expected monthly Net Revenue is a threshold a deal has
 * to clear before a discount is even the question.
 */
export interface MacSector {
  key: string;
  number: number;
  title: string;
  verticals: string[];
  mccs: string[];
  mcc_note: string | null;
  /**
   * False when the deck hedges the list — "Multiple", "Common MCCs used",
   * "Typical MCC is". A hedged MCC cannot identify the sector on its own.
   */
  mccs_exclusive: boolean;
  /** null where the deck states a tier ("Tier 3 and above") but no dollar figure. */
  min_monthly_net_revenue_usd: number | null;
  net_revenue_verbatim: string | null;
  net_revenue_detail: string | null;
  criteria: string[];
  prohibited: string[];
  source_locator: string;
}

export interface MacBook {
  source_id: string;
  source_locator: string;
  pre_submission_checklist: string[];
  chargeback_ceiling_pct: number;
  chargeback_verbatim: string;
  sectors: MacSector[];
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
  /** Product pricing frameworks. Bands here are in the deal currency, not USD. */
  vas_bands: VasVolumeBand[];
  vas_catalogue: VasFramework[];
  mcc_tier_rule: { other: string[]; standard: string[]; verbatim: string; note: string };
  mac: MacBook;
  approval_matrix: ApprovalMatrix;
  coverage_gaps: { region: string; vertical: string; reason: string }[];
  quality: Record<string, unknown>;
  skipped_rows: string[];
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** Rep's override of one fee inside a product framework. */
export interface VasFeeSelection {
  /** Fraction of the driver the fee applies to. 1 = every transaction. */
  attachRate?: number;
  /** Price the rep is actually quoting. Undefined or null means quote the recommended. */
  quotedAmount?: number | null;
}

export interface VasSelection {
  enabled: boolean;
  /**
   * Attach rate for the framework's primary (first) fee. Kept at the top level
   * because most frameworks have exactly one fee, and because a saved deal from
   * before per-fee overrides existed still has to load.
   */
  attachRate: number;
  /** Price quoted for the primary fee. Undefined means quote the recommended. */
  quotedAmount?: number | null;
  /** Overrides for the second and later fees — Integrated Platforms, APMs. */
  fees?: Record<string, VasFeeSelection>;
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
  /**
   * Merchant's chargeback ratio, in percent. Drives two independent gates: above
   * 1% every product framework prices the merchant on its Other MCC table, and
   * above 0.9% the MAC says Commercial should not submit a MAF at all.
   */
  chargebackRatioPct: number | null;
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
  /** Active sellers on the platform. Only Integrated Platforms per-seller fees need it. */
  activeSellers: number | null;

  // --- Core acquiring, priced by the rep ------------------------------------
  /** Acquirer markup as a percentage of volume. 0.15 means 0.15%, i.e. 15 bps. */
  acquirerMarkupPct: number | null;
  /** Gateway fee per transaction, in `gatewayFeeCurrency`. */
  gatewayFee: number | null;
  gatewayFeeCurrency: Currency;

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

/**
 * Where a quoted price sits against its framework's range.
 *
 * `below_floor` and `above_ceiling` are the two that cost someone an approval, and
 * they are not symmetric: below the floor is a discount the Regional leader has to
 * sign, above the ceiling is a merchant who will find out from a competitor.
 */
export type VasVerdict =
  | 'at_recommended'
  | 'above_recommended'
  | 'below_recommended'
  | 'below_floor'
  | 'above_ceiling'
  | 'no_rate';

/** One fee inside a product framework, priced for this merchant's band and tier. */
export interface VasLine {
  key: string;
  frameworkKey: string;
  label: string;
  /** Product label, for grouping multi-fee frameworks under one heading. */
  frameworkLabel: string;
  unit: FeeUnit;
  basis: string;
  /** The price being quoted — the rep's number if they set one, else recommended. */
  amount: number | null;
  /** True when `amount` is the rep's override rather than the framework's recommendation. */
  quoted: boolean;
  recommended: number | null;
  floor: number | null;
  ceiling: number | null;
  floorWaived: boolean;
  currency: string;
  attachRate: number;
  attachRateNote: string;
  bps: number | null;
  notModelledReason: string | null;
  verdict: VasVerdict;
  /** Who has to approve, when the verdict is outside the framework range. */
  approvers: string[];
  needsExtraction: boolean;
  confidence: Confidence;
  sourceId: string;
  sourceLocator: string;
  docUpdatedAt: string | null;
  notes: string;
}

export interface VasCheck {
  /** bps the framework assumes will come from VAS + FX, i.e. the "Other" line. */
  frameworkOtherBps: number;
  /** bps the selected product prices actually add up to. */
  selectedListPriceBps: number | null;
  /** null when any selected product has no rate to quote. */
  deltaBps: number | null;
  anyUnverified: boolean;
  /** VAS volume band the merchant lands in. null below the 500k framework floor. */
  band: VasVolumeBand | null;
  tier: MccTier;
  tierReason: string;
  lines: VasLine[];
  /** Mandatory products the rep has not selected. */
  mandatoryMissing: { key: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Sales Rep Adjusted Take Rate
// ---------------------------------------------------------------------------

/**
 * The rate a rep can justify, built from the bottom up.
 *
 * The guidance take rate is top-down: one blended number the framework says this
 * merchant should land on. This is the opposite direction — core acquiring plus the
 * value-added services actually on the deal, each at its own framework price,
 * added up. The two answer different questions:
 *
 *   Recommended    "what should I be aiming for?"
 *   Adjusted       "what can I defend, given what we are actually selling?"
 *
 * Deliberately NOT a discount calculation. Adjusted above recommended is not a
 * premium to approve, and adjusted below it is not a discount to sign off — the
 * approval ladder still measures the requested take rate against guidance. This
 * is a build-up a rep can walk a merchant through line by line.
 */
export interface AdjustedRateComponent {
  key: string;
  label: string;
  /** How the rep entered it — "0.15%", "$0.10 / txn", "$0.07 / event × 100%". */
  asEntered: string;
  bps: number | null;
  /** Why bps is null, when it is. */
  blockedReason: string | null;
  group: 'core_acquiring' | 'vas';
}

export interface AdjustedRate {
  components: AdjustedRateComponent[];
  coreAcquiringBps: number;
  vasBps: number;
  /** null only when nothing at all could be priced. */
  totalBps: number | null;
  /** Adjusted minus recommended. Positive means the build-up exceeds guidance. */
  deltaVsRecommendedBps: number | null;
  /** True when a component could not be converted — the total understates. */
  incomplete: boolean;
}

// ---------------------------------------------------------------------------
// MAC gate
// ---------------------------------------------------------------------------

/**
 * One thing the rep has to do about the MAC. Not a criterion — an action.
 *
 * The MAC runs to 117 criteria across nine candidate sectors for a merchant with
 * no MCC. A rep does not read that on a call. These are the handful that change
 * what they type into this tool or say to the merchant.
 */
export interface MacAction {
  key: string;
  label: string;
  detail: string;
  tone: 'blocking' | 'warning' | 'info';
}

export interface MacCheck {
  sectors: MacSector[];
  /** Monthly net revenue this deal produces, in USD, at the rate being evaluated. */
  monthlyNetRevenueUsd: number | null;
  /** Highest eNR floor across matched sectors — the one the deal has to clear. */
  requiredMonthlyNetRevenueUsd: number | null;
  requiredBy: string | null;
  clearsNetRevenue: boolean | null;
  chargebackCeilingPct: number;
  chargebackRatioPct: number | null;
  clearsChargebacks: boolean | null;
  checklist: string[];
  /** The short, actionable version. What the rep sees by default. */
  actions: MacAction[];
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
  /** The Acquirer Guidance recommendation. What approvals measure against. */
  targetBps: number | null;
  /** The rep's bottom-up build: core acquiring + the VAS actually on the deal. */
  adjusted: AdjustedRate | null;

  requestedBps: number | null;
  discountPct: number | null;
  annualRevenueAtRisk: number | null;
  emnrMonthly: number | null;
  emnrAnnual: number | null;
  mmbImpliedFloorBps: number | null;
  mmbBinds: boolean;

  approval: ApprovalOutcome | null;
  vasCheck: VasCheck | null;
  macCheck: MacCheck | null;

  /** Adjacent rows shown when status is UNMAPPED. Explicitly not guidance. */
  nearest: AcquiringRow[];
  searchedFor: Record<string, string> | null;
}
