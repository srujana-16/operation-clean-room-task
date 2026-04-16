# Assumptions Log

This document records the important judgment calls behind the current implementation.

The project intentionally contains ambiguous data and incomplete requirements. The purpose of this file is to make those decisions explicit so:
- the current behavior is understandable
- future changes know what to revisit
- interview or review discussions can explain not just what was built, but why it was built that way

---

## Data Interpretation

| # | Assumption | Rationale | Impact if Wrong | Date |
|---|-----------|-----------|----------------|------|
| 1 | Company matching treats normalized domains as the strongest non-ID signal. | The CFO explicitly called out fuzzy matching, and exact domains are usually more reliable than free-form company names. | Shared reseller domains or subsidiary domains could create false positives or false negatives. | 2026-04-16 |
| 2 | Chargebee export normalization must accept both the idealized test shape and the real export shape for `plan_changes`. | The real dataset uses `changed_at`, `from_plan`, `to_plan`, `previous_price`, `new_price`, and `prorated`, while tests use a cleaner shape. | Loader failures or silent data loss would break ARR and reconciliation for subscriptions with plan history. | 2026-04-16 |
| 3 | Legacy invoice dates default to DD/MM/YYYY when ambiguous. | The CFO brief explicitly warns that the Meridian legacy system likely uses DD/MM/YYYY and that date confusion already caused reporting issues. | Legacy month attribution could shift if some records are actually MM/DD/YYYY. | 2026-04-16 |
| 4 | Legacy invoice parsing can rely on normalized XML fields without additional schema validation for the current slice. | The initial goal is board-readiness, and the XML structure is consistent enough to normalize quickly. | Unexpected XML variants could cause ingestion errors or misread legacy invoices. | 2026-04-16 |

## Metric Definitions

| # | Assumption | Rationale | Impact if Wrong | Date |
|---|-----------|-----------|----------------|------|
| 1 | ARR trend reporting will normalize annual contract value into monthly recurring equivalents. | The board wants month-by-month ARR trends, so annual billing must be spread into comparable monthly ARR units. | Monthly ARR could be distorted if invoice timing is used instead of recurring normalization. | 2026-04-16 |
| 2 | Revenue reconciliation uses payment-date FX rather than month-end or current FX. | The CFO brief explicitly requires transaction-date FX because year-end currency movement materially affected reporting. | Multi-currency revenue would be misstated, especially around volatile periods. | 2026-04-16 |
| 3 | The initial ARR endpoint can treat Chargebee `Scale` plans as `Growth` for board-facing tier reporting. | The CFO asks for Enterprise, Growth, and Starter tiers, and the current dataset uses `Scale` as the closest practical equivalent to Growth. | Plan-tier reporting could be mislabeled until pricing-history or CRM-backed mapping is added. | 2026-04-16 |
| 4 | ARR API responses should expose dollar-denominated values rather than raw minor-unit billing values. | The frontend and CFO need readable numbers; raw cents-like units make quick validation harder and can visually overstate ARR by 100x. | Users could misread magnitudes badly if storage units leak directly into the API. | 2026-04-16 |
| 5 | The Revenue page can show ARR vs collected revenue as a useful board explanation even though full recognized revenue is not implemented. | The CFO ultimately clarified that clean ARR is the priority, but still wants help explaining the delta between subscription value and cash movement. | Viewers could over-interpret the current revenue comparison as full rev-rec if the limitation is not understood. | 2026-04-16 |

## Business Logic

| # | Assumption | Rationale | Impact if Wrong | Date |
|---|-----------|-----------|----------------|------|
| 1 | Company names are normalized by lowercasing, removing punctuation, removing `the`, and stripping common legal suffixes before comparison. | This catches obvious variants like `Acme Corp` vs `ACME Corporation Ltd.` without requiring a heavier identity model. | Some distinct but similarly named entities could be over-merged. | 2026-04-16 |
| 2 | Stripe subscription windows can be approximated from successful payment history by treating the last successful payment as covering the next 30 days. | The available Stripe dataset is payment-centric, not subscription-lifecycle-centric. | Duplicate overlap can be slightly overstated or understated for non-monthly cadence cases. | 2026-04-16 |
| 3 | When an in-period Chargebee plan change includes a proration amount, expected monthly revenue can be represented as current plan amount minus the proration adjustment. | This keeps expected revenue close to the net invoice reality in upgrade or downgrade months. | More complex multi-change months may need a fuller day-level revenue schedule later. | 2026-04-16 |
| 4 | The ARR endpoint should default to the most common subscription term start date in the dataset when no as-of date is provided. | The machine’s current date may sit outside the sample data window, which would make the default result look broken. | Users could see zero ARR and assume the API is wrong when the issue is only the default date. | 2026-04-16 |
| 5 | The first discrepancy pass can annualize Stripe and legacy billing using the latest observed recurring payment or invoice amount per customer. | This produces a fast, board-reviewable comparison against CRM annual contract values without building a full recurring schedule engine first. | Irregular billing or non-recurring invoices could be overstated or understated. | 2026-04-16 |
| 6 | The first discrepancy API should surface only mismatches above the CFO’s 2% threshold. | The brief explicitly asks for anything above 2%, so that threshold is the most relevant first cut for the board. | Smaller but still operationally useful mismatches may remain hidden until a QA-focused view is added. | 2026-04-16 |
| 7 | Duplicate-account discrepancies should be promoted into the same discrepancy review surface as billing-vs-CRM mismatches. | The CFO wants one place to see material reporting exceptions, not separate hidden technical views. | Mixing discrepancy types may blur the line between billing-vs-CRM mismatches and cross-billing duplication risk. | 2026-04-16 |

## Exclusions & Edge Cases

| # | Assumption | Rationale | Impact if Wrong | Date |
|---|-----------|-----------|----------------|------|
| 1 | The first completed frontend slice should only claim coverage for routes backed by implemented APIs. | It is better to leave unfinished pages visibly incomplete than to imply unsupported metrics are already trustworthy. | Stakeholders could mistake scaffold pages for verified board-ready functionality. | 2026-04-16 |
| 2 | Region inference can fall back from website/domain matching to exact normalized company-name matching. | Many sample records align better by company name than by billing email domain or CRM website. | Similar company names could be over-merged until stable foreign keys exist. | 2026-04-16 |
| 3 | The Revenue page can present richer arrays like `monthlyTrend`, `arrVsRevenue`, and `breakdown` from the ARR endpoint even though these are not yet split into dedicated metrics endpoints. | This creates a more useful board-facing view quickly and avoids adding multiple partially overlapping endpoints too early. | The ARR endpoint may become overloaded and harder to evolve cleanly if too many concerns accumulate there. | 2026-04-16 |
| 4 | The Discrepancy page should emphasize impact and exception counts before raw record detail. | The CFO’s first question is materiality and impact, so the page should surface summary first and record-by-record analysis second. | A user who wants raw record review immediately may feel the page is overly summary-focused. | 2026-04-16 |
| 5 | Full recognized revenue / ASC 606 treatment is out of scope for the current slice. | The CFO brief explicitly backs away from full rev-rec for the board meeting and prioritizes clean ARR. | Users may expect richer revenue timing logic than the current implementation provides. | 2026-04-16 |
| 6 | Pipeline quality, customer health, NRR, churn, cohort retention, unit economics, and audit drilldown can remain incomplete while Revenue and Discrepancies are made fully demoable first. | A truthful, working partial slice is more valuable than a broader but mostly placeholder dashboard. | The product surface remains uneven until the next slices are implemented. | 2026-04-16 |
