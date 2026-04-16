/* ─────────────────────────────────────────────────────────────────────────────
 * Shared frontend types
 *
 * Mirrors the backend domain models and adds dashboard-specific types for
 * UI state, charting, and navigation.
 * ───────────────────────────────────────────────────────────────────────────── */

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
}

// ── Revenue & ARR ────────────────────────────────────────────────────────────

export interface ARRBreakdown {
  label: string;
  arr: number;
  customerCount: number;
  percentOfTotal: number;
}

export interface MonthlyTrend {
  month: string;
  revenue: number;
  arr: number;
}

export interface RevenueBreakdownRow {
  month: string;
  new: number;
  expansion: number;
  contraction: number;
  churn: number;
}

export interface ARRVsRevenueRow {
  month: string;
  arr: number;
  revenue: number;
}


export interface ARRResponse {
  total: number;
  bySegment: ARRBreakdown[];
  byPlan: ARRBreakdown[];
  byRegion: ARRBreakdown[];
  byCohort: ARRBreakdown[];
  asOfDate: string;
  totalCustomers: number;
  avgARRPerCustomer: number;
  medianARRPerCustomer: number;
  monthlyTrend: MonthlyTrend[];
  breakdown: RevenueBreakdownRow[];
  arrVsRevenue: ARRVsRevenueRow[];
}

export interface RevenueOverview {
  currentARR: number;
  previousARR: number;
  arrGrowthRate: number;
  mrr: number;
  nrr: number;
  grossRetention: number;
  ltv: number;
  cac: number;
  ltvCacRatio: number;
  paybackMonths: number;
}


// ── Churn ────────────────────────────────────────────────────────────────────

export interface ChurnMetrics {
  grossChurnRate: number;
  netChurnRate: number;
  logoChurnRate: number;
  revenueChurnRate: number;
  churned: number;
  period: { start: string; end: string };
}

// ── NRR ──────────────────────────────────────────────────────────────────────

export interface NRRResponse {
  nrr: number;
  period: { start: string; end: string };
  components: {
    startingRevenue: number;
    expansion: number;
    contraction: number;
    churn: number;
    endingRevenue: number;
  };
  segments?: Record<string, number>;
}

// ── Unit Economics ────────────────────────────────────────────────────────────

export interface UnitEconomics {
  cac: number;
  ltv: number;
  ltvCacRatio: number;
  paybackMonths: number;
  period: string;
}

// ── Cohorts ──────────────────────────────────────────────────────────────────

export interface CohortRow {
  cohort: string;
  size: number;
  retention: number[];
  revenue: number[];
}

export interface CohortResponse {
  cohorts: CohortRow[];
  granularity: 'monthly' | 'quarterly';
}

// ── Reconciliation & Discrepancies ───────────────────────────────────────────

export type DiscrepancySeverity = 'critical' | 'high' | 'medium' | 'low';
export type DiscrepancyType =
  | 'amount_mismatch'
  | 'missing_account'
  | 'date_mismatch'
  | 'status_mismatch'
  | 'duplicate_account'
  | 'orphan_record'
  | 'fx_discrepancy';

export interface Discrepancy {
  id: string;
  type: DiscrepancyType;
  severity: DiscrepancySeverity;
  description: string;
  sourceA: {
    system: string;
    recordId: string;
    value: string | number | null;
  };
  sourceB: {
    system: string;
    recordId: string;
    value: string | number | null;
  };
  customerName: string;
  amount: number | null;
  detectedAt: string;
  resolved: boolean;
  resolutionNote: string | null;
}

export interface ReconciliationResult {
  discrepancies: Discrepancy[];
  summary: {
    totalDiscrepancies: number;
    bySeverity: Record<DiscrepancySeverity, number>;
    byType: Record<DiscrepancyType, number>;
    totalAmountImpact: number;
    recordsProcessed: Record<string, number>;
  };
  metadata: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    options: Record<string, unknown>;
  };
}

export interface DiscrepancyListResponse {
  total: number;
  summary: ReconciliationResult['summary'];
  records: Discrepancy[];
}

export interface DuplicateRecord {
  stripeRecord: {
    customerId: string;
    customerName: string;
    subscriptionId: string;
    status: string;
    startDate: string;
    endDate: string | null;
    mrr: number;
  };
  chargebeeRecord: {
    customerId: string;
    customerName: string;
    subscriptionId: string;
    status: string;
    startDate: string;
    endDate: string | null;
    mrr: number;
  };
  confidence: {
    score: number;
    matchedFields: string[];
    unmatchedFields: string[];
  };
  hasOverlap: boolean;
  overlapDays: number;
  classification: 'true_duplicate' | 'migration' | 'uncertain';
}

export interface DuplicatesResponse {
  total: number;
  byClassification: {
    true_duplicate: number;
    migration: number;
    uncertain: number;
  };
  records: DuplicateRecord[];
}

export interface ReconciliationRunSummary {
  total: number;
  bySeverity: Record<DiscrepancySeverity, number>;
  byType: Record<DiscrepancyType, number>;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineDeal {
  id: string;
  name: string;
  stage: string;
  amount: number;
  probability: number;
  daysInStage: number;
  lastActivity: string;
  isZombie: boolean;
  healthScore: number;
}

export interface PipelineQuality {
  totalDeals: number;
  totalValue: number;
  weightedValue: number;
  zombieDeals: number;
  zombieValue: number;
  stageDistribution: Record<string, { count: number; value: number }>;
  avgDaysInStage: Record<string, number>;
}

// ── Customer Health ──────────────────────────────────────────────────────────

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface CustomerHealth {
  customerId: string;
  name: string;
  healthScore: number;
  grade: HealthGrade;
  signals: {
    usage: number;
    support: number;
    payment: number;
    engagement: number;
    nps: number | null;
  };
  arr: number;
  plan: string;
  churnRisk: number;
  lastActivity: string;
}

// ── Scenarios ────────────────────────────────────────────────────────────────

export interface ScenarioInput {
  label?: string;
  churnRateDelta: number;
  expansionRateDelta: number;
  newBusinessDelta: number;
  priceDelta: number;
  costDelta: number;
}

export interface ScenarioProjection {
  month: string;
  arr: number;
  mrr: number;
  customers: number;
}

export interface ScenarioResult {
  label: string;
  input: ScenarioInput;
  projections: ScenarioProjection[];
  endingARR: number;
  arrChange: number;
  arrChangePercent: number;
  impactBreakdown: {
    churnImpact: number;
    expansionImpact: number;
    newBusinessImpact: number;
    priceImpact: number;
  };
}

export interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  input: ScenarioInput;
}

// ── Audit Trail ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

// ── Metrics Overview ─────────────────────────────────────────────────────────

export interface MetricsOverview {
  arr: ARRBreakdown;
  nrr: number;
  churn: ChurnMetrics;
  unitEconomics: UnitEconomics;
  customerCount: number;
  discrepancyCount: number;
  healthDistribution: Record<HealthGrade, number>;
}

// ── Frontend-Specific Types ──────────────────────────────────────────────────

export interface FilterState {
  dateRange: {
    start: string;
    end: string;
  };
  plan: string | null;
  region: string | null;
  segment: string | null;
}

export interface ChartDataPoint {
  label: string;
  [key: string]: string | number;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
  width?: string;
}

export interface NavigationItem {
  path: string;
  label: string;
  icon: string;
  badge?: string | number;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

// ── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface ReconciliationFilters extends PaginationParams {
  severity?: DiscrepancySeverity;
  type?: DiscrepancyType;
  sort?: string;
}
