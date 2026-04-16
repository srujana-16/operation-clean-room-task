import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { loadChargebeeSubscriptions } from '../ingestion/chargebee.js';
import { loadStripePayments } from '../ingestion/stripe.js';
import { detectDuplicates } from '../reconciliation/deduplication.js';
import { runReconciliation } from '../reconciliation/service.js';

export const reconciliationRouter = Router();

/**
 * Reconciliation API
 *
 * These endpoints expose the reconciliation engine to the dashboard.
 * The candidate should implement the following routes:
 *
 * POST /api/reconciliation/run
 *   - Trigger a full reconciliation pass across all data sources.
 *   - Body may include options such as date range, tolerance thresholds, etc.
 *   - Returns a ReconciliationResult with discrepancies and summary stats.
 *
 * GET /api/reconciliation/discrepancies
 *   - List all detected discrepancies.
 *   - Supports query params: severity, type, page, limit, sort.
 *
 * GET /api/reconciliation/discrepancies/:id
 *   - Get a single discrepancy by ID with full detail (source records, etc.).
 *
 * POST /api/reconciliation/discrepancies/:id/resolve
 *   - Mark a discrepancy as resolved with a resolution note.
 *
 * GET /api/reconciliation/duplicates
 *   - List detected cross-system duplicates.
 *   - Supports filtering by classification (true_duplicate, migration, uncertain).
 *
 * GET /api/reconciliation/pipeline
 *   - Return pipeline quality analysis results.
 */

// TODO: Implement POST /api/reconciliation/run
// reconciliationRouter.post('/run', async (req, res) => { ... });
reconciliationRouter.post('/run', async (_req, res, next) => {
  try {
    const result = await runReconciliation();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// TODO: Implement GET /api/reconciliation/discrepancies
// reconciliationRouter.get('/discrepancies', async (req, res) => { ... });
reconciliationRouter.get('/discrepancies', async (req, res, next) => {
  try {
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const result = await runReconciliation();

    const filteredDiscrepancies = result.discrepancies.filter((discrepancy) => {
      if (severity && discrepancy.severity !== severity) {
        return false;
      }

      if (type && discrepancy.type !== type) {
        return false;
      }

      return true;
    });

    res.json({
      total: filteredDiscrepancies.length,
      summary: result.summary,
      records: filteredDiscrepancies,
    });
  } catch (error) {
    next(error);
  }
});

// TODO: Implement GET /api/reconciliation/discrepancies/:id
// reconciliationRouter.get('/discrepancies/:id', async (req, res) => { ... });
reconciliationRouter.get('/discrepancies/:id', async (req, res, next) => {
  try {
    const result = await runReconciliation();
    const discrepancy = result.discrepancies.find((entry) => entry.id === req.params.id);

    if (!discrepancy) {
      res.status(404).json({
        error: 'Not Found',
        message: `No discrepancy found for id ${req.params.id}`,
      });
      return;
    }

    res.json(discrepancy);
  } catch (error) {
    next(error);
  }
});

// TODO: Implement POST /api/reconciliation/discrepancies/:id/resolve
// reconciliationRouter.post('/discrepancies/:id/resolve', async (req, res) => { ... });

// TODO: Implement GET /api/reconciliation/duplicates
// reconciliationRouter.get('/duplicates', async (req, res) => { ... });
reconciliationRouter.get('/duplicates', async (req, res, next) => {
  try {
    const classification =
      typeof req.query.classification === 'string' ? req.query.classification : undefined;

    const [stripePayments, chargebeeSubscriptions] = await Promise.all([
      loadStripePayments(DATA_DIR),
      loadChargebeeSubscriptions(DATA_DIR),
    ]);

    const duplicates = await detectDuplicates(stripePayments, chargebeeSubscriptions);
    const filteredDuplicates = classification
      ? duplicates.filter((duplicate) => duplicate.classification === classification)
      : duplicates;

    res.json({
      total: filteredDuplicates.length,
      byClassification: {
        true_duplicate: filteredDuplicates.filter(
          (duplicate) => duplicate.classification === 'true_duplicate',
        ).length,
        migration: filteredDuplicates.filter(
          (duplicate) => duplicate.classification === 'migration',
        ).length,
        uncertain: filteredDuplicates.filter(
          (duplicate) => duplicate.classification === 'uncertain',
        ).length,
      },
      records: filteredDuplicates,
    });
  } catch (error) {
    next(error);
  }
});

// TODO: Implement GET /api/reconciliation/pipeline
// reconciliationRouter.get('/pipeline', async (req, res) => { ... });

const DATA_DIR = fileURLToPath(new URL('../../../../data', import.meta.url));
