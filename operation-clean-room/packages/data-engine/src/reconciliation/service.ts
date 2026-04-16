import { fileURLToPath } from 'node:url';
import { loadChargebeeSubscriptions } from '../ingestion/chargebee.js';
import { loadLegacyInvoices } from '../ingestion/legacy.js';
import { loadStripePayments } from '../ingestion/stripe.js';
import { loadCSV } from '../ingestion/csv-loader.js';
import { detectDuplicates } from './deduplication.js';
import {
  DiscrepancyType,
  Severity,
  type Discrepancy,
  type ReconciliationResult,
  type ReconciliationSummary,
} from './types.js';

interface SalesforceAccountRow {
  account_id: string;
  account_name: string;
  region: string;
  website: string;
  annual_contract_value: number;
}

interface BillingAggregate {
  customerName: string;
  chargebeeAnnual: number;
  stripeAnnual: number;
  legacyAnnual: number;
  totalAnnual: number;
}

const DATA_DIR = fileURLToPath(new URL('../../../../data', import.meta.url));

export async function runReconciliation(): Promise<ReconciliationResult> {
  const startedAt = new Date();

  const [chargebeeSubscriptions, stripePayments, legacyInvoices, salesforceAccounts] =
    await Promise.all([
      loadChargebeeSubscriptions(DATA_DIR),
      loadStripePayments(DATA_DIR),
      loadLegacyInvoices(DATA_DIR),
      loadCSV<SalesforceAccountRow>(`${DATA_DIR}/salesforce_accounts.csv`, {
        transform: (row) => ({
          account_id: row.account_id,
          account_name: row.account_name,
          region: row.region,
          website: row.website,
          annual_contract_value: Number(row.annual_contract_value ?? 0),
        }),
      }),
    ]);

  const billingAggregates = buildBillingAggregates(chargebeeSubscriptions, stripePayments, legacyInvoices);
  const duplicates = await detectDuplicates(stripePayments, chargebeeSubscriptions);
  const discrepancies = [
    ...buildAmountDiscrepancies(billingAggregates, salesforceAccounts),
    ...buildDuplicateDiscrepancies(duplicates),
  ];

  const completedAt = new Date();

  return {
    discrepancies,
    summary: buildSummary(discrepancies, {
      stripe: stripePayments.length,
      chargebee: chargebeeSubscriptions.length,
      legacy_billing: legacyInvoices.length,
      salesforce: salesforceAccounts.length,
    }),
    metadata: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      options: {
        mismatchThresholdPercent: 2,
      },
    },
  };
}

function buildAmountDiscrepancies(
  billingAggregates: BillingAggregate[],
  salesforceAccounts: SalesforceAccountRow[],
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  const now = new Date().toISOString();

  for (const billingAggregate of billingAggregates) {
    const matchingAccount = findMatchingSalesforceAccount(billingAggregate.customerName, salesforceAccounts);

    if (!matchingAccount) {
      continue;
    }

    const crmAnnual = matchingAccount.annual_contract_value;
    const billingAnnual = billingAggregate.totalAnnual;

    if (crmAnnual <= 0) {
      continue;
    }

    const difference = roundCurrency(Math.abs(billingAnnual - crmAnnual));
    const differencePercent = crmAnnual === 0 ? 0 : (difference / crmAnnual) * 100;

    // Flag anything above the CFO's 2% materiality threshold.
    if (differencePercent <= 2) {
      continue;
    }

    discrepancies.push({
      id: `amount-${matchingAccount.account_id}`,
      type: DiscrepancyType.AMOUNT_MISMATCH,
      severity: classifySeverity(difference),
      sourceA: {
        system: 'billing_aggregate',
        recordId: billingAggregate.customerName,
        value: billingAnnual,
      },
      sourceB: {
        system: 'salesforce',
        recordId: matchingAccount.account_id,
        value: crmAnnual,
      },
      customerName: matchingAccount.account_name,
      amount: difference,
      description: `Billing annualized revenue (${billingAnnual}) differs from CRM annual contract value (${crmAnnual}) by ${differencePercent.toFixed(2)}%.`,
      detectedAt: now,
      resolved: false,
      resolutionNote: null,
    });
  }

  return discrepancies;
}

function buildDuplicateDiscrepancies(
  duplicates: Awaited<ReturnType<typeof detectDuplicates>>,
): Discrepancy[] {
  const now = new Date().toISOString();

  return duplicates
    .filter((duplicate) => duplicate.classification === 'true_duplicate')
    .map((duplicate) => ({
      id: `duplicate-${duplicate.stripeRecord.subscriptionId}-${duplicate.chargebeeRecord.subscriptionId}`,
      type: DiscrepancyType.DUPLICATE_ACCOUNT,
      severity: duplicate.overlapDays > 30 ? Severity.HIGH : Severity.MEDIUM,
      sourceA: {
        system: 'stripe',
        recordId: duplicate.stripeRecord.subscriptionId,
        value: roundCurrency(duplicate.stripeRecord.mrr / 100),
      },
      sourceB: {
        system: 'chargebee',
        recordId: duplicate.chargebeeRecord.subscriptionId,
        value: roundCurrency(duplicate.chargebeeRecord.mrr / 100),
      },
      customerName: duplicate.chargebeeRecord.customerName,
      amount: roundCurrency((duplicate.stripeRecord.mrr + duplicate.chargebeeRecord.mrr) / 100),
      description: `Potential double-counted subscription with ${duplicate.overlapDays} overlapping active days across Stripe and Chargebee.`,
      detectedAt: now,
      resolved: false,
      resolutionNote: null,
    }));
}

function buildBillingAggregates(
  chargebeeSubscriptions: Awaited<ReturnType<typeof loadChargebeeSubscriptions>>,
  stripePayments: Awaited<ReturnType<typeof loadStripePayments>>,
  legacyInvoices: Awaited<ReturnType<typeof loadLegacyInvoices>>,
): BillingAggregate[] {
  const aggregates = new Map<string, BillingAggregate>();

  for (const subscription of chargebeeSubscriptions) {
    const key = normalizeCompanyName(subscription.customer.company);
    const current = getOrCreateAggregate(aggregates, key, subscription.customer.company);
    current.chargebeeAnnual += roundCurrency((subscription.mrr * 12) / 100);
  }

  const latestStripeBySubscription = new Map<string, typeof stripePayments[number]>();
  for (const payment of stripePayments) {
    if (payment.status !== 'succeeded' || !payment.subscription_id) {
      continue;
    }

    const existingPayment = latestStripeBySubscription.get(payment.subscription_id);
    if (!existingPayment || payment.payment_date > existingPayment.payment_date) {
      latestStripeBySubscription.set(payment.subscription_id, payment);
    }
  }

  for (const payment of latestStripeBySubscription.values()) {
    const key = normalizeCompanyName(payment.customer_name);
    const current = getOrCreateAggregate(aggregates, key, payment.customer_name);
    current.stripeAnnual += roundCurrency(payment.amount * 12);
  }

  const latestLegacyByCustomer = new Map<string, typeof legacyInvoices[number]>();
  for (const invoice of legacyInvoices) {
    if (invoice.status !== 'paid') {
      continue;
    }

    const key = normalizeCompanyName(invoice.customer_name);
    const existingInvoice = latestLegacyByCustomer.get(key);
    if (!existingInvoice || invoice.date > existingInvoice.date) {
      latestLegacyByCustomer.set(key, invoice);
    }
  }

  for (const invoice of latestLegacyByCustomer.values()) {
    const key = normalizeCompanyName(invoice.customer_name);
    const current = getOrCreateAggregate(aggregates, key, invoice.customer_name);
    current.legacyAnnual += roundCurrency(invoice.amount * 12);
  }

  for (const aggregate of aggregates.values()) {
    aggregate.totalAnnual = aggregate.chargebeeAnnual + aggregate.stripeAnnual + aggregate.legacyAnnual;
  }

  return [...aggregates.values()];
}

function getOrCreateAggregate(
  aggregates: Map<string, BillingAggregate>,
  key: string,
  customerName: string,
): BillingAggregate {
  const existingAggregate = aggregates.get(key);

  if (existingAggregate) {
    return existingAggregate;
  }

  const createdAggregate: BillingAggregate = {
    customerName,
    chargebeeAnnual: 0,
    stripeAnnual: 0,
    legacyAnnual: 0,
    totalAnnual: 0,
  };

  aggregates.set(key, createdAggregate);
  return createdAggregate;
}

function findMatchingSalesforceAccount(
  customerName: string,
  accounts: SalesforceAccountRow[],
): SalesforceAccountRow | undefined {
  const normalizedCustomer = normalizeCompanyName(customerName);

  return accounts.find(
    (account) => normalizeCompanyName(account.account_name) === normalizedCustomer,
  );
}

function buildSummary(
  discrepancies: Discrepancy[],
  recordsProcessed: Record<string, number>,
): ReconciliationSummary {
  const bySeverity: Record<Severity, number> = {
    [Severity.LOW]: 0,
    [Severity.MEDIUM]: 0,
    [Severity.HIGH]: 0,
    [Severity.CRITICAL]: 0,
  };

  const byType: Record<DiscrepancyType, number> = {
    [DiscrepancyType.DUPLICATE_ACCOUNT]: 0,
    [DiscrepancyType.MISSING_ACCOUNT]: 0,
    [DiscrepancyType.AMOUNT_MISMATCH]: 0,
    [DiscrepancyType.DATE_MISMATCH]: 0,
    [DiscrepancyType.STATUS_MISMATCH]: 0,
    [DiscrepancyType.ORPHAN_RECORD]: 0,
    [DiscrepancyType.FX_DISCREPANCY]: 0,
  };

  let totalAmountImpact = 0;

  for (const discrepancy of discrepancies) {
    bySeverity[discrepancy.severity] += 1;
    byType[discrepancy.type] += 1;
    totalAmountImpact += discrepancy.amount ?? 0;
  }

  return {
    totalDiscrepancies: discrepancies.length,
    bySeverity,
    byType,
    totalAmountImpact: roundCurrency(totalAmountImpact),
    recordsProcessed,
  };
}

function classifySeverity(amount: number): Severity {
  if (amount >= 250000) {
    return Severity.CRITICAL;
  }

  if (amount >= 50000) {
    return Severity.HIGH;
  }

  if (amount >= 10000) {
    return Severity.MEDIUM;
  }

  return Severity.LOW;
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

function roundCurrency(value: number): number {
  return Math.round(value);
}
