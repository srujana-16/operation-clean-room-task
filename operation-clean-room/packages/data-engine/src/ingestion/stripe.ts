import { StripePayment } from './types.js';
import { loadCSV } from './csv-loader.js';

/**
 * Load and normalize Stripe payment data.
 *
 * Raw Stripe payments need normalization:
 * - Currency amounts may need FX conversion
 * - Failed payments with retries should be linked
 * - Refunds may appear as negative amounts or separate rows
 * - Dispute payments need special handling
 *
 * @param dataDir - Path to the data directory
 * @returns Normalized Stripe payment records
 */
export async function loadStripePayments(dataDir: string): Promise<StripePayment[]> {
  // TODO: Implement - load from stripe_payments.csv, normalize, and return
  return loadCSV<StripePayment>(`${dataDir}/stripe_payments.csv`, {
    transform: (row) => ({
      payment_id: row.payment_id,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      // Stripe export already stores amounts in major units for this dataset.
      amount: Number(row.amount),
      currency: (row.currency ?? 'usd').toLowerCase(),
      status: ((row.status ?? 'pending').toLowerCase() as StripePayment['status']),
      payment_date: row.payment_date,
      subscription_id: row.subscription_id || null,
      description: row.description || null,
      failure_code: row.failure_code || null,
      refund_id: row.refund_id || null,
      dispute_id: row.dispute_id || null,
    }),
  });
}
