import type { ARRResult, MetricOptions } from './types.js';
import { fileURLToPath } from 'node:url';
import { loadChargebeeSubscriptions } from '../ingestion/chargebee.js';
import { loadCSV } from '../ingestion/csv-loader.js';
import { loadStripePayments } from '../ingestion/stripe.js';

/**
 * Annual Recurring Revenue (ARR) calculation.
 *
 * ARR is the annualized value of all active recurring subscriptions.
 * Calculation must handle several edge cases:
 *
 * - **Trials**: Subscriptions in trial status should be excluded by default
 *   (configurable via options).  Trials that convert mid-month need careful
 *   handling -- the ARR should reflect only the post-conversion period.
 *
 * - **Multi-year deals**: Some subscriptions are billed annually or multi-
 *   annually.  The ARR for a 2-year deal at $24,000 is $12,000 (annualized),
 *   not $24,000.  Use the plan's billing period to normalize.
 *
 * - **Prorations**: Mid-month plan changes create prorated invoices.  ARR
 *   should reflect the *current* plan rate, not the prorated amount.
 *
 * - **FX conversion**: Non-USD subscriptions must be converted using the
 *   FX rate as of the calculation date.  This means ARR can fluctuate even
 *   with no subscription changes if exchange rates move.
 *
 * - **Addons**: Recurring addons contribute to ARR and should be included.
 *
 * - **Discounts**: Active coupons reduce the effective ARR.  Expired coupons
 *   mean the customer's ARR increases to the list price.
 *
 * - **Paused subscriptions**: Typically excluded from ARR but may be included
 *   if the pause is temporary and the customer is expected to resume.
 *
 * @param date - The as-of date for the ARR calculation
 * @param options - Calculation options (segmentation, exclusions, etc.)
 * @returns ARR result with total and breakdowns
 */
export async function calculateARR(
  date: Date,
  options?: MetricOptions,
): Promise<ARRResult> {
  // TODO: Implement ARR calculation
  const subscriptions = await loadChargebeeSubscriptions(DATA_DIR);
  const stripePayments = await loadStripePayments(DATA_DIR);
  const accounts = await loadCSV<SalesforceAccountRow>(`${DATA_DIR}/salesforce_accounts.csv`, {
    transform: (row) => ({
      account_id: row.account_id,
      account_name: row.account_name,
      region: row.region,
      website: row.website,
      created_date: row.created_date,
    }),
  });

  const activeSubscriptions = subscriptions.filter((subscription) => {
    if (options?.excludeTrials !== false && subscription.status === 'in_trial') {
      return false;
    }

    const termStart = toUtcDate(subscription.current_term_start);
    const termEnd = toUtcDate(subscription.current_term_end);
    return termStart <= date && termEnd >= date;
  });

  const customerArrValues: number[] = [];
  const byPlan = new Map<string, BreakdownAccumulator>();
  const bySegment = new Map<string, BreakdownAccumulator>();
  const byRegion = new Map<string, BreakdownAccumulator>();
  const byCohort = new Map<string, BreakdownAccumulator>();

  for (const subscription of activeSubscriptions) {
    const monthlyRevenue = subscription.mrr;
    // Convert subscription amounts from stored minor units into display-ready
    // dollar amounts for the board-facing metrics API.
    const annualRecurringRevenue = centsToWholeDollars(monthlyRevenue * 12);
    const planLabel = normalizePlanLabel(subscription.plan.plan_name);
    const segmentLabel = planToSegment(planLabel);
    const regionLabel = findRegionForSubscription(
      subscription.customer.company,
      subscription.customer.email,
      accounts,
    );
    // Fall back to an unknown cohort bucket if the source record is missing
    // a normalized creation date instead of failing the entire endpoint.
    const cohortLabel =
      typeof subscription.created_at === 'string' && subscription.created_at.length >= 7
        ? subscription.created_at.slice(0, 7)
        : 'Unknown';

    customerArrValues.push(annualRecurringRevenue);
    addToBreakdown(byPlan, planLabel, annualRecurringRevenue);
    addToBreakdown(bySegment, segmentLabel, annualRecurringRevenue);
    addToBreakdown(byRegion, regionLabel, annualRecurringRevenue);
    addToBreakdown(byCohort, cohortLabel, annualRecurringRevenue);
  }
  const monthlyMap = new Map<string, { month: string; revenue: number }>();

  stripePayments.filter((p) => p.status === 'succeeded')
  .forEach((p) => {
    const date = new Date(p.payment_date);
    const month = formatMonth(date);

    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { month, revenue: 0 });
    }

    monthlyMap.get(month)!.revenue += p.amount;
    
  });

  const monthlyTrend = Array.from(monthlyMap.values()).map((m) => ({
    month: m.month,
    revenue: m.revenue,
    arr: m.revenue * 12,
  }));
  
  const arrVsRevenue = monthlyTrend.map((m) => ({
    month: m.month,
    arr: m.arr,
    revenue: m.revenue,
  }));

  const breakdownMap = new Map<
    string,
    { month: string; new: number; expansion: number; contraction: number; churn: number }
  >();
  

  const customerHistory = new Map<string, number>();

  for (const subscription of activeSubscriptions) {
    const customerId = subscription.customer.customer_id;
    const currentMRR = centsToWholeDollars(subscription.mrr);
    const month = subscription.current_term_start?.slice(0, 7) || 'Unknown';

    if (!breakdownMap.has(month)) {
      breakdownMap.set(month, {
        month,
        new: 0,
        expansion: 0,
        contraction: 0,
        churn: 0,
      });
    }

    const prev = customerHistory.get(customerId);

    if (!prev) {
      breakdownMap.get(month)!.new += currentMRR;
    } else if (currentMRR > prev) {
      breakdownMap.get(month)!.expansion += currentMRR - prev;
    } else if (currentMRR < prev) {
      breakdownMap.get(month)!.contraction += prev - currentMRR;
    }

    customerHistory.set(customerId, currentMRR);
  }

  const breakdown = Array.from(breakdownMap.values());

  monthlyTrend.sort((a, b) => a.month.localeCompare(b.month));
  breakdown.sort((a, b) => a.month.localeCompare(b.month));

  const total = customerArrValues.reduce((sum, value) => sum + value, 0);
  const totalCustomers = activeSubscriptions.length;

  // console.log("DEBUG monthlyTrend:", monthlyTrend);

  return {
    total,
    bySegment: finalizeBreakdowns(bySegment, total),
    byPlan: finalizeBreakdowns(byPlan, total),
    byRegion: finalizeBreakdowns(byRegion, total),
    byCohort: finalizeBreakdowns(byCohort, total),
    asOfDate: date.toISOString().slice(0, 10),
    totalCustomers,
    avgARRPerCustomer: totalCustomers === 0 ? 0 : roundCurrency(total / totalCustomers),
    medianARRPerCustomer: calculateMedian(customerArrValues),
    monthlyTrend,
    arrVsRevenue,
    breakdown,
  };
}

export async function inferARRAsOfDate(): Promise<Date> {
  const subscriptions = await loadChargebeeSubscriptions(DATA_DIR);
  const frequencyByStartDate = new Map<string, number>();

  for (const subscription of subscriptions) {
    const startDate = subscription.current_term_start;

    if (!startDate) {
      continue;
    }

    frequencyByStartDate.set(startDate, (frequencyByStartDate.get(startDate) ?? 0) + 1);
  }

  let bestDate = '1970-01-01';
  let bestCount = -1;

  for (const [startDate, count] of frequencyByStartDate.entries()) {
    if (count > bestCount || (count === bestCount && startDate > bestDate)) {
      bestDate = startDate;
      bestCount = count;
    }
  }

  return toUtcDate(bestDate);
}

interface SalesforceAccountRow {
  account_id: string;
  account_name: string;
  region: string;
  website: string;
  created_date: string;
}

interface BreakdownAccumulator {
  arr: number;
  customerCount: number;
}

const DATA_DIR = fileURLToPath(new URL('../../../../data', import.meta.url));

function addToBreakdown(
  breakdownMap: Map<string, BreakdownAccumulator>,
  label: string,
  arr: number,
): void {
  const current = breakdownMap.get(label) ?? { arr: 0, customerCount: 0 };
  current.arr += arr;
  current.customerCount += 1;
  breakdownMap.set(label, current);
}

function finalizeBreakdowns(
  breakdownMap: Map<string, BreakdownAccumulator>,
  total: number,
): ARRResult['byPlan'] {
  return [...breakdownMap.entries()]
    .map(([label, value]) => ({
      label,
      arr: value.arr,
      customerCount: value.customerCount,
      percentOfTotal: total === 0 ? 0 : Number(((value.arr / total) * 100).toFixed(2)),
    }))
    .sort((left, right) => right.arr - left.arr);
}

function normalizePlanLabel(planName: string): string {
  if (planName.toLowerCase() === 'scale') {
    return 'Growth';
  }

  return planName;
}

function planToSegment(planLabel: string): string {
  switch (planLabel.toLowerCase()) {
    case 'enterprise':
      return 'Enterprise';
    case 'growth':
      return 'Growth';
    case 'starter':
      return 'Starter';
    default:
      return 'Legacy';
  }
}

function findRegionForSubscription(
  companyName: string,
  email: string,
  accounts: SalesforceAccountRow[],
): string {
  const subscriptionDomain = extractDomain(email);
  const normalizedCompanyName = normalizeCompanyName(companyName);

  // Prefer exact normalized company-name matches because the billing email
  // domain often differs from the CRM website domain in the sample exports.
  const nameMatch = accounts.find(
    (account) => normalizeCompanyName(account.account_name) === normalizedCompanyName,
  );

  if (nameMatch?.region) {
    return nameMatch.region;
  }

  if (!subscriptionDomain) {
    return 'Unknown';
  }

  const matchingAccount = accounts.find((account) => normalizeWebsite(account.website) === subscriptionDomain);
  return matchingAccount?.region ?? 'Unknown';
}

function extractDomain(email: string): string {
  const [, domain = ''] = email.toLowerCase().split('@');
  return domain.replace(/^www\./, '').trim();
}

function normalizeCompanyName(name: string): string {
  const legalSuffixes = new Set([
    'inc',
    'incorporated',
    'corp',
    'corporation',
    'co',
    'company',
    'ltd',
    'limited',
    'llc',
    'lp',
    'plc',
    'gmbh',
    'ag',
    'sa',
    'sas',
    'bv',
    'nv',
    'pty',
    'holdings',
    'group',
  ]);

  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !legalSuffixes.has(token))
    .join(' ')
    .trim();
}

function normalizeWebsite(website: string): string {
  const normalizedHost = website
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  return (normalizedHost ?? '').trim();
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    const left = sorted[middleIndex - 1];
    const right = sorted[middleIndex];

    if (left === undefined || right === undefined) {
      return 0;
    }

    return roundCurrency((left + right) / 2);
  }

  return sorted[middleIndex] ?? 0;
}

function toUtcDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function centsToWholeDollars(valueInCents: number): number {
  return roundCurrency(valueInCents / 100);
}

function formatMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
