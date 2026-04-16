import type { DuplicateResult, MatchConfidence } from './types.js';
import type { StripePayment, ChargebeeSubscription } from '../ingestion/types.js';
import { calculateConfidence } from './matcher.js';

/**
 * Cross-system duplicate detection.
 *
 * Identifies accounts and subscriptions that exist in multiple billing
 * systems (Stripe and Chargebee) with overlapping active periods.  This
 * is a critical reconciliation step because:
 *
 * - **Double-counting revenue**: If the same customer has active
 *   subscriptions in both Stripe and Chargebee, ARR will be overstated
 *   unless duplicates are identified and de-duplicated.
 *
 * - **Migration artifacts**: When customers were migrated from one billing
 *   system to another, the old subscription may not have been properly
 *   cancelled, resulting in a "ghost" subscription that inflates metrics.
 *
 * - **Intentional dual subscriptions**: In rare cases a customer may
 *   legitimately have subscriptions in both systems (e.g., different
 *   products or business units).  The deduplication engine should flag
 *   these but allow classification.
 *
 * The classifier should distinguish between:
 * - `true_duplicate`: Same customer, overlapping active periods, same product.
 * - `migration`: Same customer, sequential subscriptions with a gap,
 *   indicating a system migration.
 * - `uncertain`: Cannot be definitively classified; needs human review.
 *
 * @module reconciliation/deduplication
 */

/** Options for duplicate detection. */
export interface DeduplicationOptions {
  /** Name match confidence threshold (0-1). Defaults to 0.7. */
  nameThreshold?: number;
  /** Maximum gap in days between subscriptions to consider a migration. Defaults to 30. */
  migrationGapDays?: number;
  /** Whether to include cancelled subscriptions. Defaults to true. */
  includeCancelled?: boolean;
}

/**
 * Detect potential duplicates across Stripe and Chargebee.
 *
 * @param stripeData - Stripe payment/subscription data
 * @param chargebeeData - Chargebee subscription data
 * @param options - Detection options
 * @returns Array of detected duplicates with classification
 */
export async function detectDuplicates(
  stripeData: StripePayment[],
  chargebeeData: ChargebeeSubscription[],
  options?: DeduplicationOptions,
): Promise<DuplicateResult[]> {
  const nameThreshold = options?.nameThreshold ?? 0.7;
  const includeCancelled = options?.includeCancelled ?? true;
  const stripeWindows = buildStripeSubscriptionWindows(stripeData);
  const duplicates: DuplicateResult[] = [];

  for (const stripeWindow of stripeWindows) {
    for (const chargebeeSub of chargebeeData) {
      if (!includeCancelled && chargebeeSub.status === 'cancelled') {
        continue;
      }

      const confidence = await calculateConfidence(
        {
          id: stripeWindow.customerId,
          name: stripeWindow.customerName,
        },
        {
          id: chargebeeSub.customer.customer_id,
          name: chargebeeSub.customer.company,
        },
      );

      const strongNameMatch = hasExactNormalizedNameMatch(
        stripeWindow.customerName,
        chargebeeSub.customer.company,
      );

      if (confidence.score < nameThreshold && !strongNameMatch) {
        continue;
      }

      const overlapDays = calculateOverlapDays(
        stripeWindow.startDate,
        stripeWindow.endDate,
        chargebeeSub.current_term_start,
        chargebeeSub.current_term_end,
      );

      const duplicate: DuplicateResult = {
        stripeRecord: {
          customerId: stripeWindow.customerId,
          customerName: stripeWindow.customerName,
          subscriptionId: stripeWindow.subscriptionId,
          status: stripeWindow.status,
          startDate: stripeWindow.startDate,
          endDate: stripeWindow.endDate,
          mrr: stripeWindow.mrr,
        },
        chargebeeRecord: {
          customerId: chargebeeSub.customer.customer_id,
          customerName: chargebeeSub.customer.company,
          subscriptionId: chargebeeSub.subscription_id,
          status: chargebeeSub.status,
          startDate: chargebeeSub.current_term_start,
          endDate: chargebeeSub.current_term_end,
          mrr: chargebeeSub.mrr,
        },
        confidence,
        hasOverlap: overlapDays > 0,
        overlapDays,
        classification: 'uncertain',
      };

      duplicate.classification = classifyDuplicate(duplicate);

      // Keep only records that are meaningful duplicate candidates.
      if (duplicate.hasOverlap || duplicate.classification === 'migration') {
        duplicates.push(duplicate);
      }
    }
  }

  return duplicates;
}

/**
 * Classify a detected duplicate as a true duplicate, migration, or uncertain.
 *
 * Classification rules:
 * - **true_duplicate**: Both subscriptions are active and overlap by more
 *   than 7 days with the same or similar plan.
 * - **migration**: Subscriptions are sequential (one ends, another begins)
 *   with a gap of less than `migrationGapDays`.
 * - **uncertain**: Neither rule applies clearly; requires human review.
 *
 * @param duplicate - A detected duplicate result
 * @returns Classification label
 */
export function classifyDuplicate(
  duplicate: DuplicateResult,
): 'true_duplicate' | 'migration' | 'uncertain' {
  if (duplicate.hasOverlap && duplicate.overlapDays > 0) {
    return 'true_duplicate';
  }

  const stripeEnd = duplicate.stripeRecord.endDate;
  const chargebeeStart = duplicate.chargebeeRecord.startDate;

  if (!stripeEnd) {
    return 'uncertain';
  }

  const gapDays = calculateGapDays(stripeEnd, chargebeeStart);

  if (gapDays >= 0 && gapDays <= 30) {
    return 'migration';
  }

  return 'uncertain';
}

interface StripeSubscriptionWindow {
  customerId: string;
  customerName: string;
  subscriptionId: string;
  status: StripePayment['status'];
  startDate: string;
  endDate: string | null;
  mrr: number;
}

function buildStripeSubscriptionWindows(stripeData: StripePayment[]): StripeSubscriptionWindow[] {
  const groupedPayments = new Map<string, StripePayment[]>();

  for (const payment of stripeData) {
    if (!payment.subscription_id) {
      continue;
    }

    const key = `${payment.customer_id}::${payment.subscription_id}`;
    const payments = groupedPayments.get(key) ?? [];
    payments.push(payment);
    groupedPayments.set(key, payments);
  }

  const windows: StripeSubscriptionWindow[] = [];

  for (const payments of groupedPayments.values()) {
    const succeededPayments = payments
      .filter((payment) => payment.status === 'succeeded')
      .sort((left, right) => left.payment_date.localeCompare(right.payment_date));

    if (succeededPayments.length === 0) {
      continue;
    }

    const firstPayment = succeededPayments[0];
    const lastPayment = succeededPayments[succeededPayments.length - 1];

    if (!firstPayment || !lastPayment || !firstPayment.subscription_id) {
      continue;
    }

    windows.push({
      customerId: firstPayment.customer_id,
      customerName: firstPayment.customer_name,
      subscriptionId: firstPayment.subscription_id,
      status: lastPayment.status,
      startDate: firstPayment.payment_date,
      // Approximate active coverage by extending one billing cycle from the last payment.
      endDate: addDays(lastPayment.payment_date, 30),
      mrr: Math.round(lastPayment.amount),
    });
  }

  return windows;
}

function calculateOverlapDays(
  stripeStart: string,
  stripeEnd: string | null,
  chargebeeStart: string,
  chargebeeEnd: string | null,
): number {
  if (!stripeEnd || !chargebeeEnd) {
    return 0;
  }

  const overlapStart = Math.max(toUtcDate(stripeStart).getTime(), toUtcDate(chargebeeStart).getTime());
  const overlapEnd = Math.min(toUtcDate(stripeEnd).getTime(), toUtcDate(chargebeeEnd).getTime());

  if (overlapEnd < overlapStart) {
    return 0;
  }

  return Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
}

function calculateGapDays(stripeEnd: string, chargebeeStart: string): number {
  const endTime = toUtcDate(stripeEnd).getTime();
  const startTime = toUtcDate(chargebeeStart).getTime();

  return Math.floor((startTime - endTime) / DAY_MS);
}

function addDays(dateString: string, days: number): string {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toUtcDate(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function hasExactNormalizedNameMatch(left: string, right: string): boolean {
  return normalizeCompanyName(left) !== '' && normalizeCompanyName(left) === normalizeCompanyName(right);
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
