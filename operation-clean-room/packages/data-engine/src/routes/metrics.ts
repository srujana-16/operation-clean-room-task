import { Router } from 'express';
import { calculateARR, inferARRAsOfDate } from '../metrics/arr.js';

export const metricsRouter = Router();

/**
 * Metrics API
 *
 * These endpoints serve computed SaaS metrics to the dashboard.
 * The candidate should implement the following routes:
 *
 * GET /api/metrics/arr
 *   - Calculate and return current ARR with breakdowns.
 *   - Supports query params: date, segmentBy, excludeTrials.
 *
 * GET /api/metrics/nrr
 *   - Calculate net revenue retention for a given period.
 *   - Requires query params: startDate, endDate.
 *   - Optional: segmentBy.
 *
 * GET /api/metrics/churn
 *   - Calculate churn metrics (gross, net, logo, revenue).
 *   - Requires query params: startDate, endDate.
 *
 * GET /api/metrics/unit-economics
 *   - Calculate CAC, LTV, LTV/CAC ratio, payback period.
 *   - Requires query params: period (e.g. "2024-Q1").
 *
 * GET /api/metrics/cohorts
 *   - Build cohort retention analysis.
 *   - Optional query params: startMonth, endMonth, granularity.
 *
 * GET /api/metrics/overview
 *   - Aggregate summary of all key metrics for the dashboard home page.
 */

// TODO: Implement GET /api/metrics/arr
// metricsRouter.get('/arr', async (req, res) => { ... });
metricsRouter.get('/arr', async (req, res, next) => {
  try {
    const dateParam = typeof req.query.date === 'string' ? req.query.date : undefined;
    const excludeTrialsParam =
      typeof req.query.excludeTrials === 'string' ? req.query.excludeTrials : undefined;

    // Default to the dominant billing snapshot date in the source data
    // rather than the machine's current date, which may sit outside the
    // sample dataset window.
    const asOfDate = dateParam
      ? new Date(`${dateParam}T00:00:00.000Z`)
      : await inferARRAsOfDate();
    const excludeTrials =
      excludeTrialsParam === undefined ? true : excludeTrialsParam.toLowerCase() !== 'false';

    const result = await calculateARR(asOfDate, {
      excludeTrials,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// TODO: Implement GET /api/metrics/nrr
// metricsRouter.get('/nrr', async (req, res) => { ... });

// TODO: Implement GET /api/metrics/churn
// metricsRouter.get('/churn', async (req, res) => { ... });

// TODO: Implement GET /api/metrics/unit-economics
// metricsRouter.get('/unit-economics', async (req, res) => { ... });

// TODO: Implement GET /api/metrics/cohorts
// metricsRouter.get('/cohorts', async (req, res) => { ... });

// TODO: Implement GET /api/metrics/overview
// metricsRouter.get('/overview', async (req, res) => { ... });
