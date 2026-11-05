import type { DataRecord } from '../engine/types.js';
import { fieldValueType } from '../report-template/cellCapabilities.js';

export interface RuntimeFilter {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'notEmpty' | 'between';
  value?: string | number | undefined;
  upper?: string | number | undefined;
}
export interface RuntimeQuery {
  timeRange?: { field: string; from: string; to: string } | undefined;
  filters: RuntimeFilter[];
  match: 'and' | 'or';
  sort?: { field: string; order: 'asc' | 'desc' } | undefined;
  hiddenColumns: string[];
  page: number;
  pageSize: number;
  activeSheetId?: string | undefined;
}
export const emptyRuntimeQuery = (): RuntimeQuery => ({ filters: [], match: 'and', hiddenColumns: [], page: 0, pageSize: 50 });

/** 样本推断，不把数字形态的字符串转为数值，也不修改宿主记录。 */
export function runtimeFields(records: readonly DataRecord[], headers: Record<string, string> = {}) {
  const keys = new Set(Object.keys(headers));
  for (const record of records) Object.keys(record).forEach(key => keys.add(key));
  return [...keys].map(key => {
    const sample = records.find(row => row[key] !== null && row[key] !== undefined && row[key] !== '')?.[key];
    return { key, label: headers[key] || key, type: fieldValueType(undefined, sample) };
  });
}

export function matchesRuntimeFilter(record: DataRecord, filter: RuntimeFilter, type?: string): boolean {
  const raw = record[filter.field];
  const empty = raw === null || raw === undefined || raw === '';
  if (filter.operator === 'empty') return empty;
  if (filter.operator === 'notEmpty') return !empty;
  if (empty) return false;
  const scalar = (v: unknown): string | number => type === 'date'
    ? typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(String(v))
    : type === 'number' ? Number(v) : String(v);
  const left = scalar(raw), right = scalar(filter.value ?? '');
  switch (filter.operator) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'contains': return String(raw).toLocaleLowerCase().includes(String(filter.value ?? '').toLocaleLowerCase());
    case 'gt': return left > right;
    case 'gte': return left >= right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    case 'between': return left >= right && left <= scalar(filter.upper ?? '');
  }
}
