import type { MatchResult, MatchConfidence } from './types.js';

/**
 * Fuzzy matching engine for cross-system entity resolution.
 *
 * Must handle variant company names, different ID schemes, and partial
 * matches.  The matcher should use a combination of:
 *
 * - **Exact ID matching**: When external IDs (stripe_customer_id,
 *   chargebee_customer_id) are present and valid, these are the strongest
 *   signals.
 *
 * - **Domain matching**: If both entities have a website/domain field,
 *   matching domains are a very strong signal.
 *
 * - **Fuzzy name matching**: Company names vary across systems
 *   ("Acme Corp" vs "ACME Corporation Ltd." vs "acme").  Use normalized
 *   string comparison with techniques such as:
 *   - Case folding
 *   - Stripping common suffixes (Corp, Inc, Ltd, LLC, GmbH, etc.)
 *   - Token-based similarity (Jaccard, Sørensen-Dice)
 *   - Edit distance (Levenshtein)
 *
 * - **Composite scoring**: Combine signals from multiple fields into
 *   a single confidence score using configurable weights.
 *
 * @module reconciliation/matcher
 */

/** Options for controlling the entity matching process. */
export interface MatchOptions {
  /** Minimum confidence score (0-1) to consider a match. Defaults to 0.6. */
  threshold?: number;
  /** Weight for exact ID matches. Defaults to 1.0. */
  idWeight?: number;
  /** Weight for domain matches. Defaults to 0.9. */
  domainWeight?: number;
  /** Weight for name similarity. Defaults to 0.7. */
  nameWeight?: number;
  /** Whether to allow many-to-one matches. Defaults to false. */
  allowMultipleMatches?: boolean;
}

/**
 * Match entities across two data sources using fuzzy matching.
 *
 * @param sourceA - Array of entities from the first data source
 * @param sourceB - Array of entities from the second data source
 * @param options - Matching options
 * @returns Array of match results with confidence scores
 */
export async function matchEntities(
  sourceA: Record<string, unknown>[],
  sourceB: Record<string, unknown>[],
  options?: MatchOptions,
): Promise<MatchResult[]> {
  const threshold = options?.threshold ?? 0.6;
  const allowMultipleMatches = options?.allowMultipleMatches ?? false;
  const matches: MatchResult[] = [];
  const usedEntityBIds = new Set<string>();

  for (const entityA of sourceA) {
    const entityAId = getEntityId(entityA);

    if (!entityAId) {
      continue;
    }

    let bestMatch: MatchResult | null = null;

    for (const entityB of sourceB) {
      const entityBId = getEntityId(entityB);

      if (!entityBId) {
        continue;
      }

      // Keep matching one-to-one by default so a single downstream record
      // does not inflate linked customer counts.
      if (!allowMultipleMatches && usedEntityBIds.has(entityBId)) {
        continue;
      }

      const confidence = await calculateConfidence(entityA, entityB);

      if (confidence.score < threshold) {
        continue;
      }

      const candidate: MatchResult = {
        entityA: toMatchEntity(entityA),
        entityB: toMatchEntity(entityB),
        confidence,
      };

      // Preserve only the strongest candidate for each source-A entity.
      if (!bestMatch || candidate.confidence.score > bestMatch.confidence.score) {
        bestMatch = candidate;
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);

      if (!allowMultipleMatches) {
        usedEntityBIds.add(bestMatch.entityB.id);
      }
    }
  }

  return matches;
}

/**
 * Calculate the confidence score for a potential match between two entities.
 *
 * @param entityA - First entity (must have at minimum: id, name)
 * @param entityB - Second entity (must have at minimum: id, name)
 * @returns Confidence assessment with score, matched fields, and unmatched fields
 */
export async function calculateConfidence(
  entityA: Record<string, unknown>,
  entityB: Record<string, unknown>,
): Promise<MatchConfidence> {
  const matchedFields: string[] = [];
  const unmatchedFields: string[] = [];

  const normalizedNameA = normalizeName(getStringField(entityA, ['name', 'account_name', 'customer_name', 'company']));
  const normalizedNameB = normalizeName(getStringField(entityB, ['name', 'account_name', 'customer_name', 'company']));
  const domainA = normalizeDomain(getStringField(entityA, ['domain', 'website', 'email']));
  const domainB = normalizeDomain(getStringField(entityB, ['domain', 'website', 'email']));
  const idA = getEntityId(entityA);
  const idB = getEntityId(entityB);

  let score = 0;
  let totalWeight = 0;

  // Exact IDs are useful when present, but many systems use different IDs
  // for the same customer, so we keep this as a light signal.
  const idWeight = 0.1;
  totalWeight += idWeight;
  if (idA && idB && idA === idB) {
    score += idWeight;
    matchedFields.push('id');
  } else {
    unmatchedFields.push('id');
  }

  // Domain equality is the strongest non-ID signal because it is usually
  // more reliable than free-form account names.
  const domainWeight = 0.55;
  totalWeight += domainWeight;
  if (domainA && domainB && domainA === domainB) {
    score += domainWeight;
    matchedFields.push('domain');
  } else {
    unmatchedFields.push('domain');
  }

  // This catches obvious variants once legal suffixes and punctuation
  // have been stripped out of the raw names.
  const exactNameWeight = 0.15;
  totalWeight += exactNameWeight;
  if (normalizedNameA && normalizedNameB && normalizedNameA === normalizedNameB) {
    score += exactNameWeight;
    matchedFields.push('normalized_name');
  } else {
    unmatchedFields.push('normalized_name');
  }

  // Token overlap gives partial credit to near-matches without forcing
  // them into the same bucket as exact normalized-name equality.
  const tokenSimilarityWeight = 0.2;
  totalWeight += tokenSimilarityWeight;
  const nameSimilarity = calculateTokenSimilarity(normalizedNameA, normalizedNameB);
  if (nameSimilarity > 0) {
    score += tokenSimilarityWeight * nameSimilarity;
    matchedFields.push('name_similarity');
  } else {
    unmatchedFields.push('name_similarity');
  }

  const finalScore = totalWeight === 0 ? 0 : Math.max(0, Math.min(1, score / totalWeight));

  return {
    score: Number(finalScore.toFixed(4)),
    matchedFields,
    unmatchedFields,
  };
}

function toMatchEntity(entity: Record<string, unknown>): MatchResult['entityA'] {
  return {
    ...entity,
    id: getEntityId(entity) ?? 'unknown',
    source: getStringField(entity, ['source', 'system']) ?? 'unknown',
  };
}

function getEntityId(entity: Record<string, unknown>): string | null {
  return (
    getStringField(entity, [
      'id',
      'account_id',
      'customer_id',
      'subscription_id',
      'stripe_customer_id',
      'chargebee_customer_id',
    ]) ?? null
  );
}

function getStringField(entity: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = entity[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function normalizeName(name: string | null): string {
  if (!name) {
    return '';
  }

  // Drop common legal/entity suffixes so "Acme Corp" and
  // "Acme Corporation Ltd." collapse to the same comparable core.
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

  const normalized = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => !legalSuffixes.has(token));

  return normalized.join(' ').trim();
}

function normalizeDomain(value: string | null): string {
  if (!value) {
    return '';
  }

  const trimmedValue = value.trim().toLowerCase();
  const withoutEmailPrefix = trimmedValue.includes('@') ? trimmedValue.split('@').pop() ?? '' : trimmedValue;

  // Normalize URLs and email-derived domains into the same host-only shape.
  const normalizedHost = withoutEmailPrefix
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  return (normalizedHost ?? '').trim();
}

function calculateTokenSimilarity(nameA: string, nameB: string): number {
  if (!nameA || !nameB) {
    return 0;
  }

  if (nameA === nameB) {
    return 1;
  }

  const tokensA = new Set(nameA.split(/\s+/).filter(Boolean));
  const tokensB = new Set(nameB.split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionCount += 1;
    }
  }

  // Jaccard-style overlap: shared tokens divided by total unique tokens.
  const unionCount = new Set([...tokensA, ...tokensB]).size;

  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}
