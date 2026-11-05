import * as VTablePkg from '@visactor/vtable';
import type { DataRecord } from '../../../engine/types.js';
import { matchesRuntimeFilter, runtimeFields, type RuntimeQuery } from '../../../report/runtimeQuery.js';
import { compareTableValues } from '../table/tableSummary.js';

const sdk: any = (VTablePkg as any).data ? VTablePkg : (VTablePkg as any).default;

/** 在完整事实集上调用SDK公开筛选/排序API，完成后再编译汇总；不对已合并的矩阵逐行排序。 */
export function queryReportRecords(records: readonly DataRecord[], query: RuntimeQuery): DataRecord[] {
  const fields = runtimeFields(records);
  const types = new Map(fields.map(field => [field.key, field.type]));
  const source = sdk.data.CachedDataSource.ofArray([...records], {}, undefined, fields.map(field => ({ field: field.key, sort: compareTableValues })));
  try {
    const filters = query.filters.filter(filter => ['empty', 'notEmpty'].includes(filter.operator) || filter.value !== undefined && (filter.operator !== 'between' || filter.upper !== undefined));
    if (filters.length || query.timeRange) source.updateFilterRules([{ filterFunc: (record: DataRecord) => {
      if (query.timeRange && !matchesRuntimeFilter(record, { id: 'time', field: query.timeRange.field, operator: 'between', value: query.timeRange.from, upper: query.timeRange.to }, 'date')) return false;
      if (!filters.length) return true;
      const matches = filters.map(filter => matchesRuntimeFilter(record, filter, types.get(filter.field)));
      return query.match === 'or' ? matches.some(Boolean) : matches.every(Boolean);
    } }]);
    if (query.sort?.field) source.sort([{ field: query.sort.field, order: query.sort.order, orderFn: compareTableValues }]);
    return Array.from({ length: source.length }, (_, index) => source.get(index));
  } finally {
    source.release();
  }
}

/** 只为显示窗口选择行；调用方已经对完整筛选集完成聚合，翻页不会重新计算本页总计。 */
export function reportPageRows(rowCount: number, headerRows: number, page: number, pageSize: number): number[] {
  const header = Math.min(Math.max(0, headerRows), rowCount);
  const source = sdk.data.CachedDataSource.ofArray(Array.from({ length: rowCount - header }, (_, i) => i + header));
  try {
    source.updatePagination({ currentPage: page, perPageCount: pageSize });
    return [...Array.from({ length: header }, (_, i) => i), ...Array.from({ length: source.length }, (_, i) => source.get(i))];
  } finally {
    source.release();
  }
}
