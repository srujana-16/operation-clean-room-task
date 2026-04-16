import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, ShieldAlert, RefreshCw } from 'lucide-react';
import { getDiscrepancies } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Table } from '@/components/ui/Table';
import type { Discrepancy, DiscrepancySeverity, DiscrepancyType, DiscrepancyListResponse } from '@/types';

const severityOptions: Array<{ label: string; value: DiscrepancySeverity | 'all' }> = [
  { label: 'All severities', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

const typeOptions: Array<{ label: string; value: DiscrepancyType | 'all' }> = [
  { label: 'All types', value: 'all' },
  { label: 'Amount mismatch', value: 'amount_mismatch' },
  { label: 'Duplicate account', value: 'duplicate_account' },
];

export function DiscrepancyTable() {
  const [severity, setSeverity] = useState<DiscrepancySeverity | 'all'>('all');
  const [type, setType] = useState<DiscrepancyType | 'all'>('all');

  const queryKey = useMemo(
    () => ['reconciliation', 'discrepancies', severity, type],
    [severity, type],
  );

  const { data, isLoading, isError, error, refetch, isFetching } =
    useApi<DiscrepancyListResponse>(
      queryKey,
      () =>
        getDiscrepancies({
          severity: severity === 'all' ? undefined : severity,
          type: type === 'all' ? undefined : type,
        }),
    );

  if (isLoading) {
    return <LoadingState />;
  }

  if (isError || !data) {
    return (
      <ErrorState
        message={error?.message ?? 'Unable to load discrepancy records'}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            Reconciliation Review
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-100">
            Discrepancy Monitor
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            View of discrepancies identified during reconciliation across billing systems. Includes account-level mismatches, duplicate records, and all issues exceeding the CFO threshold, with their corresponding financial impact.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Open Discrepancies"
          value={formatInteger(data.total)}
          icon={<AlertTriangle size={16} />}
        />
        <Card
          title="Amount Impact"
          value={formatCurrency(data.summary.totalAmountImpact)}
          icon={<ArrowRightLeft size={16} />}
        />
        <Card
          title="High + Critical"
          value={formatInteger(
            data.summary.bySeverity.high + data.summary.bySeverity.critical,
          )}
          icon={<ShieldAlert size={16} />}
        />
        <Card
          title="Duplicate Accounts"
          value={formatInteger(data.summary.byType.duplicate_account)}
          icon={<AlertTriangle size={16} />}
        />
      </section>

      <section className="card rounded-lg border border-slate-800 p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Filters</h3>
            <p className="mt-1 text-xs text-slate-500">
              Narrow the first-pass reconciliation exceptions by severity or discrepancy type.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <FilterSelect
              label="Severity"
              value={severity}
              options={severityOptions}
              onChange={(value) => setSeverity(value as DiscrepancySeverity | 'all')}
            />
            <FilterSelect
              label="Type"
              value={type}
              options={typeOptions}
              onChange={(value) => setType(value as DiscrepancyType | 'all')}
            />
          </div>
        </div>
      </section>

      <section className="card rounded-lg border border-slate-800 p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-100">Discrepancy Records</h3>
          <p className="mt-1 text-xs text-slate-500">
            Source-system comparison rows generated by the current reconciliation run.
          </p>
        </div>

        <Table<Discrepancy>
          data={data.records}
          rowKey={(row) => row.id}
          emptyMessage="No discrepancies match the current filter."
          columns={[
            {
              key: 'severity',
              label: 'Severity',
              sortable: true,
              render: (value) => <SeverityBadge severity={String(value) as DiscrepancySeverity} />,
            },
            {
              key: 'type',
              label: 'Type',
              sortable: true,
              render: (value) => (
                <span className="font-mono text-xs uppercase tracking-wide text-slate-300">
                  {String(value).replace(/_/g, ' ')}
                </span>
              ),
            },
            {
              key: 'customerName',
              label: 'Customer',
              sortable: true,
              render: (value, row) => (
                <div>
                  <p className="font-medium text-slate-100">{String(value)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.sourceA.system} vs {row.sourceB.system}
                  </p>
                </div>
              ),
            },
            {
              key: 'amount',
              label: 'Impact',
              sortable: true,
              render: (value) => (
                <span className="font-mono text-slate-100">
                  {value == null ? '—' : formatCurrency(Number(value))}
                </span>
              ),
            },
            {
              key: 'description',
              label: 'Description',
              render: (value) => (
                <p className="max-w-xl text-sm leading-6 text-slate-300">
                  {String(value)}
                </p>
              ),
            },
            {
              key: 'detectedAt',
              label: 'Detected',
              sortable: true,
              render: (value) => (
                <span className="font-mono text-xs text-slate-400">
                  {formatDateTime(String(value))}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-[180px] flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-slate-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SeverityBadge({ severity }: { severity: DiscrepancySeverity }) {
  if (severity === 'critical') {
    return <Badge variant="error">Critical</Badge>;
  }

  if (severity === 'high') {
    return <Badge variant="warning">High</Badge>;
  }

  if (severity === 'medium') {
    return <Badge variant="info">Medium</Badge>;
  }

  return <Badge variant="neutral">Low</Badge>;
}

function LoadingState() {
  return (
    <div className="p-6">
      <div className="card rounded-lg border border-slate-800 p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-200">Loading discrepancies</h2>
        <p className="mt-2 text-sm text-slate-500">
          Pulling the latest reconciliation exceptions from the backend.
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-6">
      <div className="card rounded-lg border border-red-500/20 bg-red-500/5 p-8 text-center">
        <h2 className="text-lg font-semibold text-red-200">Discrepancy monitor unavailable</h2>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
