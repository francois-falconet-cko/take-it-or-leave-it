/**
 * Checkout.com brand tokens.
 *
 * Hex values were sampled directly from the artwork embedded in
 * `_assets/Brand Kit Core Guidelines 2026.md` rather than eyeballed, so the app
 * chrome matches the deck it will be shown alongside. If the brand kit is
 * reissued, resample — do not hand-tweak these.
 *
 * This governs the *builder's own* chrome only. The checkout preview is styled
 * by lib/themes.ts, because the whole point of section 3 is that Flow takes on
 * the merchant's brand, not ours.
 */

export const BRAND = {
  /** Base canvas. Charcoal with a blue cast, not a neutral grey. */
  surface: '#23242B',
  /** One step up: cards, the left panel's section bodies. */
  surfaceRaised: '#2F2F34',
  /** Two steps up: rows, inputs, selected states. */
  surfaceHigh: '#3A3A40',
  /** Sunk wells — the preview stage the checkout sits in. */
  surfaceSunken: '#1C1D24',

  /** Primary brand fill. Used for large blocks and the primary action. */
  blue: '#2A5DF5',
  /** Accent blue for emphasis, links, and active nav. Brighter than `blue`. */
  blueBright: '#165FFF',

  text: '#F8FAFD',
  textMuted: '#A3A4AD',
  textFaint: '#60616A',

  border: '#3A3A40',
  borderStrong: '#4E4F57',

  /**
   * The four brand attributes, each with its own colour. Used here as a semantic
   * palette so coaching marks and callouts stay on-brand instead of reaching for
   * generic Tailwind colours.
   */
  attribute: {
    /** Humble — purple. */
    humble: '#841AFF',
    /** Expert — blue. Doubles as the coaching-mark colour. */
    expert: '#165FFF',
    /** Unconventional — orange. Doubles as warning / error accents. */
    unconventional: '#FF4F18',
    /** Ambitious — lime. Doubles as success and metric callouts. */
    ambitious: '#B3FF00',
  },
} as const;

/** Brand platform line, for the kiosk's idle and reset states. */
export const BRAND_PLATFORM = 'Where the world checks out';

export const BRAND_POSITIONING =
  'Passionate about payments, obsessed with performance.';

/**
 * Voice rules that affect rendering rather than copy, pulled from the brand kit:
 * headlines run 2–6 words in caps, and product names are never abbreviated.
 */
export const VOICE = {
  /** Headlines are set in caps in most digital formats. */
  headlineTransform: 'uppercase' as const,
  /** No closing period on headlines or subheadings. */
  headlinePunctuation: false,
} as const;
