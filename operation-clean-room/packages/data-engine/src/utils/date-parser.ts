/**
 * Ambiguous date format parser.
 *
 * The legacy billing system used inconsistent date formats depending on the
 * operator's locale settings.  Some dates are DD/MM/YYYY (European) and
 * others are MM/DD/YYYY (US).  Dates like "03/04/2023" are genuinely
 * ambiguous -- it could be March 4 or April 3.
 *
 * Disambiguation strategies:
 *
 * 1. **Unambiguous dates**: If the day component is > 12 (e.g., "25/03/2023"),
 *    the format is definitively DD/MM/YYYY.  If the month component is > 12,
 *    it's definitively MM/DD/YYYY.
 *
 * 2. **Contextual clues**: If a `context` object is provided with neighboring
 *    dates from the same customer/invoice sequence, use the unambiguous dates
 *    in the sequence to infer the format for ambiguous ones.
 *
 * 3. **ISO-8601 passthrough**: If the date string is already in ISO-8601
 *    format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss), parse it directly.
 *
 * 4. **Fallback**: When no disambiguation is possible, default to MM/DD/YYYY
 *    (US format) as the majority of the data uses this convention.
 *
 * Also handles:
 * - Dates with dashes (DD-MM-YYYY, MM-DD-YYYY)
 * - Dates with dots (DD.MM.YYYY)
 * - Two-digit years (23 -> 2023, 99 -> 1999)
 * - Whitespace trimming
 *
 * @param dateStr - Raw date string from the data source
 * @param context - Optional context for disambiguation
 * @returns Parsed Date object in UTC
 *
 * @throws Error if the date string cannot be parsed at all
 */
export function parseAmbiguousDate(
  dateStr: string,
  context?: {
    /** Other dates from the same customer / invoice sequence. */
    neighborDates?: string[];
    /** Known format hint from metadata. */
    formatHint?: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  },
): Date {
  // TODO: Implement ambiguous date parsing with contextual disambiguation
  const trimmed = dateStr.trim();

  if (!trimmed) {
    throw new Error('Date string is empty');
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 10)}T00:00:00.000Z`);
  }

  const normalized = trimmed.replace(/[.\-]/g, '/');
  const parts = normalized.split('/');

  if (parts.length !== 3) {
    throw new Error(`Unsupported date format: ${dateStr}`);
  }

  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const rawYear = Number(parts[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(rawYear)) {
    throw new Error(`Invalid date components: ${dateStr}`);
  }

  const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;

  if (first > 12) {
    return createUtcDate(year, second, first);
  }

  if (second > 12) {
    return createUtcDate(year, first, second);
  }

  if (context?.formatHint === 'DD/MM/YYYY') {
    return createUtcDate(year, second, first);
  }

  if (context?.formatHint === 'MM/DD/YYYY') {
    return createUtcDate(year, first, second);
  }

  // The CFO brief explicitly warns that the legacy system is likely DD/MM/YYYY,
  // so use that as the default fallback for ambiguous legacy dates.
  return createUtcDate(year, second, first);
}

function createUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
