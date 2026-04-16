import { DollarSign, Users, Map, CalendarDays, TrendingUp, BarChart3 } from 'lucide-react';
import { getARR } from '@/api/client';
import { useApi } from '@/hooks/useApi';
import { Card } from '@/components/ui/Card';
import { Chart } from '@/components/ui/Chart';
import { Table } from '@/components/ui/Table';
import type { ARRBreakdown, ARRResponse } from '@/types';

export function RevenueSummary() {
  const { data, isLoading, isError, error, refetch, isFetching } = useApi<ARRResponse>(
    ['metrics', 'arr', 'default'],
    () => getARR(),
  );

  if (isLoading) {
    return <LoadingState />;
  }

  if (isError || !data) {
    return (
      <ErrorState
        message={error?.message ?? 'Unable to load ARR summary'}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const planChartData = data.byPlan.map((entry) => ({
    label: entry.label,
    arr: entry.arr,
  }));

  const cohortChartData = data.byCohort
    .slice()
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(-12)
    .map((entry) => ({
      label: entry.label,
      arr: entry.arr,
    }));

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            Revenue Snapshot
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-100">
            ARR Overview
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Revenue performance across billing systems.
            Includes ARR trends, revenue breakdown, and cash vs subscription comparisons.
            All metrics are derived from reconciled backend data and are traceable to source records.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">
            As Of
          </p>
          <p className="mt-1 font-mono text-sm text-slate-200">{data.asOfDate}</p>
          {isFetching && (
            <p className="mt-1 text-xs text-slate-500">Refreshing data...</p>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Total ARR"
          value={formatCurrency(data.total)}
          icon={<DollarSign size={16} />}
        >
          <p className="mt-3 text-xs text-slate-500">
            Current annual recurring revenue in dollar units.
          </p>
        </Card>

        <Card
          title="Customers"
          value={formatInteger(data.totalCustomers)}
          icon={<Users size={16} />}
        >
          <p className="mt-3 text-xs text-slate-500">
            Active subscription count included in the ARR snapshot.
          </p>
        </Card>

        <Card
          title="Avg ARR / Customer"
          value={formatCurrency(data.avgARRPerCustomer)}
          icon={<Map size={16} />}
        >
          <p className="mt-3 text-xs text-slate-500">
            Useful for spotting whether mix skews upmarket or downmarket.
          </p>
        </Card>

        <Card
          title="Median ARR / Customer"
          value={formatCurrency(data.medianARRPerCustomer)}
          icon={<CalendarDays size={16} />}
        >
          <p className="mt-3 text-xs text-slate-500">
            Better than the average for understanding the typical customer.
          </p>
        </Card>
        
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="card rounded-lg border border-slate-800 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-100">ARR By Cohort</h3>
            <p className="mt-1 text-xs text-slate-500">
              Latest 12 cohorts, sorted chronologically.
            </p>
          </div>

          <Chart
            type="area"
            data={cohortChartData}
            xAxisKey="label"
            series={[{ key: 'arr', label: 'ARR', color: '#3b82f6' }]}
            height={320}
          />
        </div>

        <div className="card rounded-lg border border-slate-800 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-100">ARR By Plan</h3>
            <p className="mt-1 text-xs text-slate-500">
            </p>
          </div>

          <Chart
            type="bar"
            data={planChartData}
            xAxisKey="label"
            series={[{ key: 'arr', label: 'ARR', color: '#22c55e' }]}
            height={320}
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card
          title="Monthly ARR Trend"
          value="ARR Over Time"
          icon={<CalendarDays size={16} />}
        >
          <Chart
            type="area"
            data={data.monthlyTrend?.slice(-12).map((m) => ({
              label: m.month,
              arr: m.arr,
            })) || []}
            xAxisKey="label"
            series={[{ key: 'arr', label: 'ARR', color: '#6366f1' }]}
            height={220}
          />
          <p className="mt-3 text-xs text-slate-500">
            Monthly ARR trend.
          </p>
        </Card>

        <Card
          title="ARR vs Revenue"
          value="Subscription vs Cash"
          icon={<BarChart3 size={16} />}
        >
          <Chart
            type="line"
            data={data.arrVsRevenue?.slice(-12).map((m) => ({
              label: m.month,
              arr: m.arr,
              revenue: m.revenue,
            })) || []}
            xAxisKey="label"
            series={[
              { key: 'arr', label: 'ARR', color: '#3b82f6' },
              { key: 'revenue', label: 'Revenue', color: '#22c55e' },
            ]}
            height={220}
          />
          <p className="mt-3 text-xs text-slate-500">
            Helps explain ARR vs actual collected revenue.
          </p>
        </Card>

        <Card
          title="Revenue Breakdown"
          value="New vs Expansion vs Contraction"
          icon={<TrendingUp size={16} />}
        >
          <Table
            data={data.breakdown || []}
            columns={[
              {
                key: 'month',
                label: 'Month',
                sortable: true,
              },
              {
                key: 'new',
                label: 'New',
                sortable: true,
                render: (v) => formatCurrency(Number(v || 0)),
              },
              {
                key: 'expansion',
                label: 'Expansion',
                sortable: true,
                render: (v) => formatCurrency(Number(v || 0)),
              },
              {
                key: 'contraction',
                label: 'Contraction',
                sortable: true,
                render: (v) => formatCurrency(Number(v || 0)),
              },
              {
                key: 'churn',
                label: 'Churn',
                sortable: true,
                render: (v) => (
                  <span className="text-red-400">
                    {formatCurrency(Number(v || 0))}
                  </span>
                ),
              },
            ]}
            rowKey={(row) => `breakdown-${row.month}`}
          />
          <p className="mt-3 text-xs text-slate-500">
            Explains how revenue changes month-over-month.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <BreakdownTable
          title="Plan Breakdown"
          description="Recurring revenue by current billing plan."
          rows={data.byPlan}
        />
        <BreakdownTable
          title="Region Breakdown"
          description="Current regional mix from Salesforce-linked accounts."
          rows={data.byRegion}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <BreakdownTable
          title="Segment Breakdown"
          description="Board-facing customer tier buckets."
          rows={data.bySegment}
        />
        <BreakdownTable
          title="Cohort Breakdown"
          description="Cohort contribution to ARR based on subscription creation month."
          rows={data.byCohort.slice().sort((left, right) => right.arr - left.arr)}
        />
      </section>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: ARRBreakdown[];
}) {
  return (
    <div className="card rounded-lg border border-slate-800 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>

      <Table<ARRBreakdown>
        data={rows}
        columns={[
          {
            key: 'label',
            label: 'Label',
            sortable: true,
          },
          {
            key: 'arr',
            label: 'ARR',
            sortable: true,
            render: (value) => (
              <span className="font-mono text-slate-100">
                {formatCurrency(Number(value ?? 0))}
              </span>
            ),
          },
          {
            key: 'customerCount',
            label: 'Customers',
            sortable: true,
            render: (value) => (
              <span className="font-mono">{formatInteger(Number(value ?? 0))}</span>
            ),
          },
          {
            key: 'percentOfTotal',
            label: '% of Total',
            sortable: true,
            render: (value) => (
              <span className="font-mono">{formatPercent(Number(value ?? 0))}</span>
            ),
          },
        ]}
        rowKey={(row) => `${title}-${row.label}`}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="p-6">
      <div className="card rounded-lg border border-slate-800 p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-200">Loading ARR summary</h2>
        <p className="mt-2 text-sm text-slate-500">
          Pulling the current recurring revenue snapshot from the backend.
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
        <h2 className="text-lg font-semibold text-red-200">ARR summary unavailable</h2>
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

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}
