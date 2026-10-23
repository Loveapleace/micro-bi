/**
 * 通用记录值比较工具 (comparison.ts)
 * 纯函数模块，为排序提供稳定、可预测的比较语义：
 * - 数值（含千分位字符串 "1,234"）按数值比较，避免 "10" < "9" 的字典序陷阱；
 * - 纯文本按自然排序（zh-CN + numeric）比较，时间桶键（如 '2026-09'）可正确排序；
 * - null / undefined / '' / NaN / Infinity 视为“空值”，恒排至末尾，不随升降序翻转。
 */
import { toAggregableNumber } from './aggregation.js';

/** 判断值是否应视为“空值”（排序时恒排末尾）。 */
export function isEmptyLike(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'number' && !Number.isFinite(value))
  );
}

/** 比较两个标量值，返回负数/零/正数（空值排在非空值之后）。 */
export function compareRecordValues(a: unknown, b: unknown): number {
  const aEmpty = isEmptyLike(a);
  const bEmpty = isEmptyLike(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const numA = toAggregableNumber(a);
  const numB = toAggregableNumber(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    if (numA === numB) return 0;
    return numA < numB ? -1 : 1;
  }
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

/** 依据多列排序规则比较两条记录（空值恒排末尾，不随升降序翻转）。 */
export function compareWithSortRules(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  sorts: readonly { field: string; order?: 'asc' | 'desc' }[]
): number {
  for (const s of sorts) {
    const valA = a[s.field];
    const valB = b[s.field];
    const aEmpty = isEmptyLike(valA);
    const bEmpty = isEmptyLike(valB);
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) continue;
      return 1; // 空值恒排末尾
    }
    const comp = compareRecordValues(valA, valB);
    if (comp !== 0) return s.order === 'desc' ? -comp : comp;
  }
  return 0;
}
