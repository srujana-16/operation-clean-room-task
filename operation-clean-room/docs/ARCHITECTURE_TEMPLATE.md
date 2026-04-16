# Architecture Document

## System Overview

The current system is a TypeScript monorepo with a backend data engine and a dashboard.

The implemented data flow is:

1. Raw source files are read from `data/`.
2. Backend ingestion loaders normalize each source into shared TypeScript records.
3. Reconciliation and metric modules compute business outputs from those normalized records.
4. Express route handlers expose those outputs under `/api`.
5. The frontend calls those APIs through a small client layer.
6. Feature pages render cards, charts, filters, and tables from the live API responses.

The currently completed end-to-end segment covers:
- revenue / ARR visibility
- discrepancy visibility
- duplicate-account visibility through API


### Implemented Flow

For the current implemented segment, the actual runtime flow is:

- Revenue page:
  `data/*` -> loaders -> `calculateARR()` -> `GET /api/metrics/arr` -> `getARR()` -> `RevenueSummary.tsx`

- Discrepancy page:
  `data/*` -> loaders -> `runReconciliation()` -> `GET /api/reconciliation/discrepancies` -> `getDiscrepancies()` -> `DiscrepancyTable.tsx`

## Data Model

### Unified Customer Model

There is not yet a single persisted canonical customer table.

#### The current implementation uses a derived customer identity strategy:

1. explicit IDs when comparable IDs exist
2. normalized company name matching
3. normalized domain matchingsegment

This is a practical board-readiness approach rather than a final production identity graph.

#### Why this was chosen:
- the CFO needed reliable numbers quickly
- the source systems do not share one stable universal key
- a lightweight, explainable entity-resolution layer is easier to defend than a heavier model built under time pressure

#### Tradeoff:
- simpler and faster to implement
- less robust than a fully persisted canonical-customer model with reviewed mappings

### Source Data Mapping

| Source | Key Fields | Links To | Current Use | Issues Found |
|--------|-----------|----------|-------------|-------------|
| Stripe Payments | `customer_id`, `customer_name`, `amount`, `currency`, `payment_date`, `subscription_id` | Duplicate detection, ARR trend support, discrepancy annualization, revenue reconciliation | Active | Real subscription lifecycle is inferred from payments rather than explicitly loaded |
| Chargebee Subscriptions | `customer.company`, `customer.email`, `plan`, `mrr`, `current_term_start`, `current_term_end`, `plan_changes` | ARR, duplicate detection, revenue reconciliation, discrepancy annualization | Active | Real export schema differs from test fixture schema, especially for `plan_changes` |
| Legacy Invoices | `customer_name`, `amount`, `currency`, `date`, `status`, `payment_ref` | Discrepancy annualization and future legacy reconciliation | Active | Ambiguous dates, mixed conventions, XML format |
| Salesforce Accounts | `account_name`, `region`, `website`, `annual_contract_value` | ARR region mapping and billing-vs-CRM discrepancy comparison | Active | Current implementation relies on name/domain matching, not stable direct foreign keys |
| Salesforce Opportunities | `account_name`, `stage`, `amount`, `close_date`, `contract_term_months` | Pipeline-quality analysis | Not yet wired into live dashboard | Route scaffold exists but implementation is still pending |
| Product Events | product telemetry fields | Customer health scoring, cohort analysis | Not yet implemented  | Large dataset not yet modeled into health metrics |
| Support Tickets | ticket/account metadata | Customer health scoring | Not yet implemented | Not yet aggregated into account-level health signals |
| NPS Surveys | account / score / survey date | Customer health scoring | Not yet implemented  | Not yet integrated with health model |
| Marketing Spend | channel / spend / conversions | Unit economics | Not yet implemented | Attribution ambiguity explicitly called out in CFO brief |
| Plan Pricing | plan pricing history | ARR and pricing logic | Not yet wired | Needed for richer tier and legacy-plan mapping |
| FX Rates | dated FX rates | Revenue reconciliation, future multi-currency metrics | Partially active | ARR currently uses a simplified path while revenue reconciliation uses dated FX |
| Partner Deals | partner margin and deal metadata | Future net revenue / channel handling | Not yet implemented  | Needed to net out partner margins properly |

## Matching Strategy

### Entity Resolution Approach

The current matcher lives in `packages/data-engine/src/reconciliation/matcher.ts`.

It uses a weighted composite score across:
- exact ID equality
- exact normalized domain equality
- exact normalized company-name equality
- token overlap on normalized company names

Normalization removes:
- punctuation
- case differences
- the word `the`
- legal suffixes such as `inc`, `corp`, `corporation`, `ltd`, `llc`, `gmbh`

Why this approach was chosen:
- the CFO explicitly asked for fuzzy matching
- the matching logic needed to be easy to explain and audit
- a deterministic matcher is easier to defend than a black-box model

Alternative approaches:
- Fuse.js or pure fuzzy-search ranking
- Levenshtein-only matching
- embedding-based semantic matching
- manually maintained mapping tables

Tradeoffs:
- current approach is explainable and fast
- it is not as accurate as a richer canonical-identity system with reviewed mappings

### Confidence Scoring

The default automatic-match threshold is `0.6`.

The current weight split is:
- `0.10` exact ID
- `0.55` exact normalized domain
- `0.15` exact normalized name
- `0.20` token similarity

Why domain is weighted most heavily:
- company names are noisier than domains
- the CFO brief explicitly warned that names may vary across systems

Tradeoff:
- this reduces some false positives
- but it can still under-match when domain data is missing or misleading

## Duplicate Detection

The duplicate detector lives in `packages/data-engine/src/reconciliation/deduplication.ts`.

Current method:
- Stripe payments are grouped by `customer_id + subscription_id`
- successful payments are turned into inferred active windows
- Chargebee provides explicit subscription windows
- the two windows are compared

Classifications:
- `true_duplicate`
- `migration`
- `uncertain`

Why this was chosen:
- duplicate revenue from Stripe + Chargebee is explicitly called out in the CFO brief
- the available Stripe data is payments, not a richer subscription lifecycle export

Alternative approaches:
- load true Stripe subscription state if available
- include plan/product similarity in duplicate scoring
- push uncertain matches into a manual-review workflow

Tradeoffs:
- payment-derived windows are fast and practical
- they are less precise than explicit lifecycle state

## Revenue Reconciliation

The current revenue reconciliation primitive lives in `packages/data-engine/src/reconciliation/revenue.ts`.

It currently separates:
- expected subscription revenue
- actual collected payment revenue

Handled well today:
- annual-to-monthly normalization
- payment-date FX conversion
- Chargebee prorations for in-period plan changes

Not fully handled yet:
- complete recognized revenue logic
- full ASC 606 treatment
- comprehensive discount and timing issue surfacing in the UI

Why this scope was chosen:
- the CFO ultimately clarified that clean ARR is the main board need for now
- the user still wanted revenue-related visibility, but not a full accounting project in this phase

Tradeoff:
- enough to support core reconciliation logic
- not sufficient for full controller-grade revenue recognition

## ARR Implementation

The ARR logic lives in `packages/data-engine/src/metrics/arr.ts`.

The current ARR response includes:
- `total`
- `bySegment`
- `byPlan`
- `byRegion`
- `byCohort`
- `avgARRPerCustomer`
- `medianARRPerCustomer`
- `monthlyTrend`
- `arrVsRevenue`
- `breakdown`

Why the response is richer than a single total:
- the frontend Revenue page needs more than one headline number
- the CFO wants trend, tier mix, and breakdown visibility

Current ARR method:
- load Chargebee subscriptions
- load Stripe payments
- load Salesforce accounts for region mapping
- filter active subscriptions by as-of date
- annualize subscription MRR into ARR
- group into plan / segment / region / cohort breakdowns
- derive monthly trend helpers from Stripe payment history

Important implementation shortcuts:
- current ARR is Chargebee-led for recurring subscription state
- `Scale` is mapped to `Growth`
- region uses normalized company-name matching first and website/domain matching second
- the default as-of date is inferred from the dominant billing snapshot date in the dataset

Alternative approaches:
- compute ARR from a unified recurring-revenue fact table across all billing systems
- compute ARR from CRM ACV only
- separate ARR and revenue trend into different endpoints

Tradeoffs:
- the current response is good for board-readiness and frontend speed
- it is not yet a final canonical recurring-revenue model

## Reconciliation Service

The orchestration layer lives in `packages/data-engine/src/reconciliation/service.ts`.

It powers:
- `POST /api/reconciliation/run`
- `GET /api/reconciliation/discrepancies`
- `GET /api/reconciliation/discrepancies/:id`

What it does:
- loads Chargebee, Stripe, legacy invoices, and Salesforce accounts
- builds annualized billing aggregates
- compares billing aggregates against CRM annual contract values
- flags amount mismatches above 2%
- converts true duplicate overlaps into duplicate-account discrepancies
- returns a summary plus discrepancy records

Why this was chosen:
- discrepancy logic should not be duplicated directly in route handlers
- the backend needed one reusable service layer for the first board-review exception flow

Alternative approaches:
- compute discrepancies inline in Express routes
- persist reconciliation snapshots in storage
- use a scheduled background job and serve stored runs

Tradeoffs:
- current approach is clean and lightweight
- recalculation on request is simpler but less efficient than persisted runs

## Metric Definitions

### ARR (Annual Recurring Revenue)

Definition:
- annualized recurring subscription value from active subscriptions in the current ARR slice

Formula:
- `ARR = active subscription MRR * 12`

Current edge cases handled:
- exclude trials by default
- annualize recurring amounts from stored minor-unit values
- map `Scale` to `Growth`
- return `Unknown` cohort if a record is missing creation-date shape

Current edge cases not fully solved:
- complete legacy-plan segmentation
- fully canonical multi-system recurring base
- full escalator-aware multi-year treatment

### Discrepancy Amount Comparison

Definition:
- difference between annualized billing-side value and Salesforce annual contract value for matched accounts

Formula:
- `difference = abs(billingAnnual - crmAnnual)`
- record is flagged when `difference / crmAnnual > 2%`

Current billing annualization inputs:
- Chargebee annualized from subscription MRR
- Stripe annualized from latest successful recurring payment per subscription
- legacy annualized from latest paid invoice per customer

Tradeoff:
- fast and useful for board review
- not yet a full historical recurring schedule

### Duplicate Account Discrepancy

Definition:
- a `true_duplicate` Stripe/Chargebee overlap promoted into a discrepancy record

Current purpose:
- make double-count risk visible in the same review flow as billing-vs-CRM mismatches

## Assumptions

The detailed assumptions log is maintained in `docs/ASSUMPTIONS_TEMPLATE.md`.

## Known Limitations

The current system is still module-first rather than pipeline-first.

That means:
- matching works
- duplicate detection works
- revenue reconciliation primitives work
- ARR works
- discrepancy orchestration works

But they are not yet part of one persisted, canonical monthly reconciliation workflow.

Major current limitations:
- ARR is not yet a full canonical multi-source recurring metric
- discrepancy annualization is pragmatic rather than final
- no persisted reconciliation runs
- no audit-trail drilldown
- no live NRR / churn / cohort / unit-economics / health / pipeline pages

## Future Extensibility - How would someone:

### Add a new billing source

1. Add a loader in `packages/data-engine/src/ingestion/`
2. Normalize it into shared types
3. Feed it into the relevant metric or reconciliation module
4. Update assumptions if it introduces ambiguity
5. Update frontend only when the visible contract changes

### Add a new metric

1. Build the metric in `packages/data-engine/src/metrics/`
2. Expose it through a route in `packages/data-engine/src/routes/`
3. Align frontend types in `packages/dashboard/src/types/index.ts`
4. Render it in a feature page under `packages/dashboard/src/components/features/`

### Change reconciliation schedule

The current design recalculates on demand. Moving to monthly or weekly runs would likely require:
- persisted run storage
- reconciliation run metadata
- background job or scheduled automation

### Add a new segmentation dimension

1. Carry the dimension through normalized records or lookup maps
2. Extend grouping logic in the relevant metric module
3. Add frontend presentation 
