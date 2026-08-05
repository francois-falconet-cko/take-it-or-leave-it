# [CONFIDENTIAL] Authentication Pricing Framework

> **Extraction note:** This Markdown reconstruction is based on accessible indexed snippets from the uploaded PDF and internal references to the same asset. Some formatting, labels, ordering, and slide-level details were only partially available, so uncertain areas are marked explicitly.

## Disclaimer

The information shared in this deck is **PRIVATE & CONFIDENTIAL** and intended for internal use only.

For any questions please reach out to: `strategic.pricing@checkout.com`

---

## Merchant Breakdown (Standard - Other MCCs)

### Other MCCs

- Merchants with a Chargeback Ratio above 1%
- Or line of business with a CKO risk rating of **“Restricted”** or **“High”** as listed in this MCC Risk List

### Standard MCCs

- Line of business with a CKO risk rating of **“Medium”** or **“Low”** as listed in this MCC Risk List

---

## CKO Authentication Pricing Framework per Authentication Attempt (IC++)

### Pricing table A *(likely Standard MCCs; label order was partially obscured)*

| Monthly Processing Volume ($/£/€) | 500k - 1m | 1m - 2m | 2m - 5m | 5m - 10m | 10m - 20m | 20m+ |
|---|---:|---:|---:|---:|---:|---:|
| Recommended ($/£/€) | 0.03 | 0.03 | 0.03 | 0.03 | 0.02 | 0.02 |
| Floor ($/£/€) | 0.02 | 0.02 | 0.02 | 0.02 | 0.01 | 0.005 |

- Ceiling ($/£/€): **0.07** *(a single ceiling value was visible; per-tier ceiling breakdown was not visible)*

### Pricing table B *(likely Other MCCs; label order was partially obscured)*

| Monthly Processing Volume ($/£/€) | 500k - 1m | 1m - 2m | 2m - 5m | 5m - 10m | 10m - 20m | 20m+ |
|---|---:|---:|---:|---:|---:|---:|
| Recommended ($/£/€) | 0.05 | 0.05 | 0.04 | 0.04 | 0.03 | 0.03 |
| Floor ($/£/€) | 0.03 | 0.03 | 0.03 | 0.03 | 0.02 | 0.01 |

- Ceiling ($/£/€): **0.10** *(a single ceiling value was visible; per-tier ceiling breakdown was not visible)*

---

## Standalone Merchants Pricing

The recommendation is to price standalone merchants higher than the recommended pricing level, as CKO will not be generating revenue from other products.

---

## IC++ vs Blended Pricing

- If acquiring is on blended pricing, authentication will also need to be blended.
- To price blended, add the Scheme Fees (as outlined separately) to the premium fee.

---

## Approval

- Approval is required from the **Regional Revenue Leader** to price below the floor or above the ceiling.

---

## Additional Notes

- For more information on the Standard/Other MCCs classification, refer to the appendix.
- Pricing for Authentication is mandatory.
- Free trials are not allowed.

---

## Market / Competitive Notes *(partial extraction; exact provider-to-line mapping was not fully visible)*

- Market range is **$0.01 - $0.06**.
- Providers took advantage of the introduction of **3DS2** to introduce **3DS fees**.
- Pricing range: **$0.015 - $0.06**.
- Starting point: **$0.05**.
- Range: **$0.01 - $0.03**.
- Starting point: **$0.03**.
- Pricing can be **as low as $0.005**.
- Pricing models mentioned include **IC++** and **Blended**.
- One note indicates **Enterprise: IC++** and **SMEs: Blended IC++**.
- **Adyen** sometimes offers to waive the 3DS fee for merchants doing Processing, Revenue Protect, and Acquiring with Adyen.
- **Nuvei** has a separate fee for Smart 3DS (exemptions, smart routing 3DS1/3DS2).

---

## Confidence Notes

- The uploaded PDF was only partially accessible through indexed snippets.
- The pricing tables above are reconstructed from visible text and internal references to the same asset.
- The association of table A vs. table B to **Standard MCCs** and **Other MCCs** is highly likely based on the relative pricing levels and related internal references, but the exact visual label placement was not fully visible in the extracted text.
