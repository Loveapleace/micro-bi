import { TYPES } from '@visactor/vtable';

export function formatTableValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '-';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '-';
    }
  }
  return String(value);
}

/** 比较规则交给原生sort回调；总计不再作为record参与排序。 */
export function compareTableValues(a: unknown, b: unknown, order: string = 'asc'): -1 | 0 | 1 {
  if (a === b) return 0;
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const x = Number(a);
  const y = Number(b);
  const result = !Number.isNaN(x) && !Number.isNaN(y)
    ? Math.sign(x - y)
    : String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
  const directed = order.toLowerCase() === 'desc' ? -result : result;
  return directed > 0 ? 1 : directed < 0 ? -1 : 0;
}

/** 统计口径来自共享引擎，聚合行的布局、排序隔离和刷新由VTable维护。 */
export function createSummaryAggregation(value: unknown): TYPES.CustomAggregation {
  return {
    aggregationType: TYPES.AggregationType.CUSTOM,
    showOnTop: false,
    aggregationFun: () => value,
    formatFun: formatTableValue,
  };
}
