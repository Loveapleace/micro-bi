/**
 * 区域级事实过滤统一实现 (regionFilter.ts)
 * 纯函数模块，统一 expandTemplate (v1) 与 cellExpansionEngine (v2) 两套引擎的过滤语义，
 * 消除此前两处实现行为不一致的问题（eq 松散相等 vs String 相等、in 非数组值放行/过滤相反等）。
 *
 * 语义约定：
 * - eq/ne：宽松相等（'1' 与 1 视为相等；null 与 undefined 视为相等）；
 * - gt/gte/lt/lte：数值比较，任一侧非有限数值时该记录不满足条件（被过滤）；
 * - in/nin：value 为数组时按成员宽松匹配；value 为单个标量时自动视为单元素数组；
 * - 未知操作符：视为无条件匹配（放行）。
 */
import type { DataRecord } from '../engine/types.js';
import type { RegionFilter } from './types.js';
import { toAggregableNumber } from '../engine/aggregation.js';

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // eslint-disable-next-line eqeqeq
  return a == b || String(a) === String(b);
}

/** 判断单条记录是否满足单条过滤规则。 */
export function matchesRegionFilter(record: DataRecord, filter: RegionFilter): boolean {
  const val = (record as Record<string, unknown>)[filter.field];
  switch (filter.operator) {
    case 'eq':
      return looseEquals(val, filter.value);
    case 'ne':
      return !looseEquals(val, filter.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = toAggregableNumber(val);
      const right = toAggregableNumber(filter.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      switch (filter.operator) {
        case 'gt':
          return left > right;
        case 'gte':
          return left >= right;
        case 'lt':
          return left < right;
        case 'lte':
          return left <= right;
        default:
          return false;
      }
    }
    case 'in': {
      const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
      return arr.some((v) => looseEquals(val, v));
    }
    case 'nin': {
      const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
      return !arr.some((v) => looseEquals(val, v));
    }
    default:
      return true;
  }
}

/** 按全部过滤规则（AND 语义）过滤记录集。 */
export function applyRegionFilters(
  records: readonly DataRecord[],
  filters: readonly RegionFilter[]
): DataRecord[] {
  if (!filters || filters.length === 0) return [...records];
  return records.filter((rec) => filters.every((f) => matchesRegionFilter(rec, f)));
}
