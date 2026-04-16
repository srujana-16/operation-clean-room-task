import { useState, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import type { SortState } from '@/types';

interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
  width?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onSort?: (sort: SortState) => void;
  className?: string;
  emptyMessage?: string;
  rowKey?: (row: T, index: number) => string;
}

export function Table<T extends object>({
  columns,
  data,
  onSort,
  className,
  emptyMessage = 'No data available',
  rowKey,
}: TableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);

  const handleSort = useCallback(
    (key: string) => {
      const next: SortState =
        sort?.key === key && sort.direction === 'asc'
          ? { key, direction: 'desc' }
          : { key, direction: 'asc' };
      setSort(next);
      onSort?.(next);
    },
    [sort, onSort],
  );

  const sortedData = useMemo(() => {
    if (!sort) return data;
    return [...data].sort((a, b) => {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const aVal = aRecord[sort.key];
      const bVal = bRecord[sort.key];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = aVal < bVal ? -1 : 1;
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [data, sort]);

  const getKey = (row: T, index: number) =>
    rowKey ? rowKey(row, index) : ((row as Record<string, unknown>)['id'] as string) ?? String(index);

  return (
    <div
      className={clsx(
        'overflow-auto rounded-lg border border-slate-700/50',
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="table-header">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400',
                  col.sortable && 'cursor-pointer select-none hover:text-slate-200',
                  col.className,
                )}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <div className="flex items-center gap-1.5">
                  <span>{col.label}</span>
                  {col.sortable && (
                    <span className="text-slate-600">
                      {sort?.key === col.key ? (
                        sort.direction === 'asc' ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      ) : (
                        <ChevronsUpDown size={12} />
                      )}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, idx) => (
              <tr key={getKey(row, idx)} className="table-row">
                {columns.map((col) => {
                  // Table columns are configured with string keys, so cast to a
                  // generic dictionary shape when reading cell values.
                  const rowRecord = row as Record<string, unknown>;
                  return (
                  <td
                    key={col.key}
                    className={clsx(
                      'px-4 py-3 text-slate-300',
                      col.className,
                    )}
                  >
                    {col.render
                      ? col.render(rowRecord[col.key], row)
                      : (rowRecord[col.key] as React.ReactNode) ?? '\u2014'}
                  </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
