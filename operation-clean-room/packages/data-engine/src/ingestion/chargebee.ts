import { ChargebeeSubscription } from './types.js';
import { loadJSON } from './json-loader.js';

/**
 * Load and normalize Chargebee subscription data.
 *
 * Chargebee subscriptions have a deeply nested JSON structure that requires
 * careful handling:
 *
 * - **Nested customer object**: Customer details are embedded inside each
 *   subscription.  The same customer may appear across multiple subscriptions
 *   and must be de-duplicated.
 *
 * - **Coupons**: Subscriptions may have one or more coupons with percentage
 *   or fixed-amount discounts.  Coupons can have expiry dates, so MRR
 *   calculations must check whether coupons are still active.
 *
 * - **Plan changes**: A subscription's `plan_changes` array records every
 *   upgrade, downgrade, or lateral move.  Proration amounts on plan changes
 *   affect revenue recognition for the period in which they occur.
 *
 * - **Trial handling**: Subscriptions in `in_trial` status have a `trial_end`
 *   date on their plan object.  These should generally be excluded from ARR
 *   unless specifically requested.  When a trial converts, the first payment
 *   date may differ from the subscription creation date.
 *
 * - **Addons**: Additional line items that contribute to MRR but are tracked
 *   separately from the base plan price.
 *
 * @param dataDir - Path to the data directory
 * @returns Normalized Chargebee subscription records
 */
export async function loadChargebeeSubscriptions(
  dataDir: string,
): Promise<ChargebeeSubscription[]> {
  // TODO: Implement - load from chargebee_subscriptions.json, normalize, and return
  const rawData = await loadJSON<{
    subscriptions: Array<{
      id: string;
      customer: {
        id: string;
        company: string;
        email: string;
      };
      plan: {
        id: string;
        name: string;
        price: number;
        currency: string;
        interval: 'month' | 'year';
      };
      status: ChargebeeSubscription['status'];
      trial_end: string | null;
      created_at: string;
      cancelled_at: string | null;
      current_term_start: string;
      current_term_end: string;
      addons: Array<{
        id: string;
        name: string;
        quantity: number;
        unit_price: number;
      }>;
      coupons: Array<{
        id: string;
        name: string;
        discount_type: 'percentage' | 'fixed_amount';
        discount_value: number;
        apply_on?: 'invoice_amount' | 'each_specified_item';
        valid_from?: string;
        valid_till?: string | null;
      }>;
      plan_changes: Array<{
        change_date?: string;
        changed_at?: string;
        previous_plan?: string;
        from_plan?: string;
        new_plan?: string;
        to_plan?: string;
        previous_amount: number;
        new_amount: number;
        change_type: 'upgrade' | 'downgrade' | 'lateral';
        proration_amount?: number | null;
        previous_price?: number;
        new_price?: number;
        prorated?: number | null;
      }>;
    }>;
  }>(`${dataDir}/chargebee_subscriptions.json`);

  return rawData.subscriptions.map((subscription) => ({
    subscription_id: subscription.id,
    customer: {
      customer_id: subscription.customer.id,
      first_name: '',
      last_name: '',
      email: subscription.customer.email,
      company: subscription.customer.company,
      billing_address: {
        line1: '',
        city: '',
        state: '',
        country: '',
        zip: '',
      },
    },
    plan: {
      plan_id: subscription.plan.id,
      plan_name: subscription.plan.name,
      price: subscription.plan.price,
      currency: subscription.plan.currency.toLowerCase(),
      billing_period: 1,
      billing_period_unit: subscription.plan.interval,
      trial_end: subscription.trial_end ? toDateOnly(subscription.trial_end) : null,
    },
    status: subscription.status,
    current_term_start: toDateOnly(subscription.current_term_start),
    current_term_end: toDateOnly(subscription.current_term_end),
    created_at: toDateOnly(subscription.created_at),
    cancelled_at: subscription.cancelled_at ? toDateOnly(subscription.cancelled_at) : null,
    cancel_reason: null,
    mrr: getMonthlyRecurringRevenue(subscription.plan.price, subscription.plan.interval),
    coupons: (subscription.coupons ?? []).map((coupon) => ({
      coupon_id: coupon.id,
      coupon_name: coupon.name,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      apply_on: coupon.apply_on ?? 'invoice_amount',
      valid_from: toDateOnly(coupon.valid_from ?? subscription.created_at),
      valid_till: coupon.valid_till ? toDateOnly(coupon.valid_till) : null,
    })),
    plan_changes: (subscription.plan_changes ?? []).map((change) => ({
      change_date: toDateOnly(change.change_date ?? change.changed_at ?? subscription.created_at),
      previous_plan: change.previous_plan ?? change.from_plan ?? 'unknown',
      new_plan: change.new_plan ?? change.to_plan ?? 'unknown',
      previous_amount: change.previous_amount ?? change.previous_price ?? 0,
      new_amount: change.new_amount ?? change.new_price ?? 0,
      change_type: change.change_type,
      proration_amount: change.proration_amount ?? change.prorated ?? null,
    })),
    addons: (subscription.addons ?? []).map((addon) => ({
      addon_id: addon.id,
      addon_name: addon.name,
      quantity: addon.quantity,
      unit_price: addon.unit_price,
    })),
    metadata: {},
  }));
}

function toDateOnly(value: string | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}

function getMonthlyRecurringRevenue(price: number, interval: 'month' | 'year'): number {
  return interval === 'year' ? price / 12 : price;
}
