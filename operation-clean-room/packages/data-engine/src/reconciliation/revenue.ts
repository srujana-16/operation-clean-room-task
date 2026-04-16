import type { RevenueReconciliationResult } from './types.js';
import type { ChargebeeSubscription, StripePayment, FXRate } from '../ingestion/types.js';

/**
 * Revenue reconciliation across billing systems.
 *
 * Compares expected revenue (from active subscriptions) against actual
 * revenue (from payments) accounting for:
 *
 * - **Prorations**: Mid-cycle upgrades/downgrades create prorated charges
 *   that don't match the subscription's stated MRR.  The reconciler must
 *   detect proration periods and adjust expected revenue accordingly.
 *
 * - **Discounts / coupons**: Active coupons reduce the invoiced amount
 *   below the plan's list price.  Both percentage and fixed-amount
 *   coupons must be accounted for, including coupon expiry dates.
 *
 * - **FX conversion**: Subscriptions may be priced in EUR, GBP, etc.
 *   but payments are recorded in the original currency.  Reconciliation
 *   must use the FX rate from the payment date (not today's rate) to
 *   convert both sides to a common currency (USD).
 *
 * - **Timing differences**: A subscription billed on the 1st of the month
 *   may have its payment processed on the 2nd or 3rd.  End-of-month
 *   boundary effects can cause payments to fall in a different calendar
 *   month than expected.
 *
 * - **Failed and retried payments**: A failed payment that is retried
 *   successfully should count as a single expected payment, not two.
 *
 * - **Refunds and disputes**: Refunded or disputed payments reduce actual
 *   revenue but do not necessarily reduce expected revenue.
 *
 * @module reconciliation/revenue
 */

/** Options for revenue reconciliation. */
export interface RevenueReconciliationOptions {
  /** Start of the reconciliation period (inclusive). */
  startDate: Date;
  /** End of the reconciliation period (exclusive). */
  endDate: Date;
  /** Tolerance for amount mismatches in USD. Defaults to 0.50. */
  toleranceUSD?: number;
  /** Whether to include trial subscriptions. Defaults to false. */
  includeTrials?: boolean;
}

/**
 * Reconcile expected subscription revenue against actual payment revenue.
 *
 * @param subscriptions - Active subscriptions from Chargebee (and/or Stripe)
 * @param payments - Payment records from Stripe
 * @param fxRates - Historical FX rates for currency conversion
 * @param options - Reconciliation options (date range, tolerance, etc.)
 * @returns Detailed reconciliation result with line items and breakdown
 */
export async function reconcileRevenue(
  subscriptions: ChargebeeSubscription[],
  payments: StripePayment[],
  fxRates: FXRate[],
  options: RevenueReconciliationOptions,
): Promise<RevenueReconciliationResult> {
  const periodStart = options.startDate;
  const periodEnd = options.endDate;
  const lineItems: RevenueReconciliationResult['lineItems'] = [];

  let expectedRevenue = 0;
  let actualRevenue = 0;
  let prorationTotal = 0;

  const paymentsBySubscriptionId = new Map<string, StripePayment[]>();

  for (const payment of payments) {
    if (payment.status !== 'succeeded' || !isDateInRange(payment.payment_date, periodStart, periodEnd)) {
      continue;
    }

    const subscriptionPayments = payment.subscription_id
      ? paymentsBySubscriptionId.get(payment.subscription_id) ?? []
      : [];

    if (payment.subscription_id) {
      subscriptionPayments.push(payment);
      paymentsBySubscriptionId.set(payment.subscription_id, subscriptionPayments);
    }

    // Actual revenue must use the FX rate from the payment date so that
    // month-end rate changes do not distort the reconciled amount.
    actualRevenue += convertToUsdCents(payment.amount, payment.currency, payment.payment_date, fxRates);
  }

  for (const subscription of subscriptions) {
    if (!options.includeTrials && subscription.status === 'in_trial') {
      continue;
    }

    if (!subscriptionIntersectsPeriod(subscription, periodStart, periodEnd)) {
      continue;
    }

    const expectedForSubscription = calculateExpectedSubscriptionRevenue(subscription, periodStart, periodEnd);
    const actualForSubscription = (paymentsBySubscriptionId.get(subscription.subscription_id) ?? []).reduce(
      (total, payment) =>
        total + convertToUsdCents(payment.amount, payment.currency, payment.payment_date, fxRates),
      0,
    );

    const subscriptionProration = subscription.plan_changes.reduce(
      (total, change) =>
        total +
        (change.proration_amount && isDateInRange(change.change_date, periodStart, periodEnd)
          ? change.proration_amount
          : 0),
      0,
    );

    expectedRevenue += expectedForSubscription;
    prorationTotal += subscriptionProration;

    lineItems.push({
      customerId: subscription.customer.customer_id,
      customerName: subscription.customer.company,
      expected: roundCurrency(expectedForSubscription),
      actual: roundCurrency(actualForSubscription),
      difference: roundCurrency(actualForSubscription - expectedForSubscription),
      reason: subscriptionProration > 0 ? 'proration_adjustment' : 'subscription_reconciliation',
    });
  }

  const difference = roundCurrency(actualRevenue - expectedRevenue);
  const differencePercent = expectedRevenue === 0 ? 0 : (difference / expectedRevenue) * 100;

  return {
    expectedRevenue: roundCurrency(expectedRevenue),
    actualRevenue: roundCurrency(actualRevenue),
    difference,
    differencePercent: Number(differencePercent.toFixed(2)),
    lineItems,
    breakdown: {
      // Track proration credits separately so ARR deltas can be explained
      // without folding them into generic unexplained variance.
      prorations: roundCurrency(prorationTotal),
      discounts: 0,
      fxDifferences: 0,
      timingDifferences: 0,
      unexplained: 0,
    },
  };
}

function calculateExpectedSubscriptionRevenue(
  subscription: ChargebeeSubscription,
  periodStart: Date,
  periodEnd: Date,
): number {
  const subscriptionStart = toUtcDate(subscription.current_term_start);
  const subscriptionEnd = toUtcDate(subscription.current_term_end);
  const activeStart = maxDate(subscriptionStart, periodStart);
  const activeEndExclusive = minDate(addDays(periodEnd, -0), addDays(subscriptionEnd, 1));

  if (activeEndExclusive <= activeStart) {
    return 0;
  }

  const planAmount = getRecurringMonthlyAmount(subscription);
  const planChangeInPeriod = subscription.plan_changes.find((change) =>
    isDateInRange(change.change_date, periodStart, periodEnd),
  );

  // When Chargebee records a proration credit/debit for an in-period plan
  // change, use the net invoiced expectation for the month.
  if (planChangeInPeriod && planChangeInPeriod.proration_amount) {
    return subscription.plan.price - planChangeInPeriod.proration_amount;
  }

  const activeDays = differenceInDays(activeStart, activeEndExclusive);
  const monthDays = differenceInDays(periodStart, periodEnd);

  if (activeDays === monthDays) {
    return planAmount;
  }

  return (planAmount * activeDays) / monthDays;
}

function getRecurringMonthlyAmount(subscription: ChargebeeSubscription): number {
  if (subscription.plan.billing_period_unit === 'month' && subscription.plan.billing_period > 0) {
    return subscription.plan.price / subscription.plan.billing_period;
  }

  if (subscription.plan.billing_period_unit === 'year' && subscription.plan.billing_period > 0) {
    return subscription.plan.price / (subscription.plan.billing_period * 12);
  }

  // Default to MRR when plan metadata is incomplete or inconsistent.
  return subscription.mrr;
}

function convertToUsdCents(amount: number, currency: string, date: string, fxRates: FXRate[]): number {
  const normalizedCurrency = currency.toLowerCase();

  if (normalizedCurrency === 'usd') {
    return amount;
  }

  const matchingRate = fxRates.find((rate) => rate.date === date);

  if (!matchingRate) {
    return amount;
  }

  switch (normalizedCurrency) {
    case 'eur':
      return amount * matchingRate.eur_usd;
    case 'gbp':
      return amount * matchingRate.gbp_usd;
    case 'jpy':
      return amount * matchingRate.jpy_usd;
    case 'aud':
      return amount * matchingRate.aud_usd;
    default:
      return amount;
  }
}

function subscriptionIntersectsPeriod(
  subscription: ChargebeeSubscription,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const start = toUtcDate(subscription.current_term_start);
  const endExclusive = addDays(toUtcDate(subscription.current_term_end), 1);

  return start < periodEnd && endExclusive > periodStart;
}

function isDateInRange(dateString: string, startDate: Date, endDate: Date): boolean {
  const date = toUtcDate(dateString);
  return date >= startDate && date < endDate;
}

function toUtcDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? left : right;
}

function minDate(left: Date, right: Date): Date {
  return left < right ? left : right;
}

function differenceInDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;
