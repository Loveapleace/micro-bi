/**
 * 表格全局总计行智能度量计算模块 (summaryCalculator)
 * - 针对聚合度量与计算列进行科学的统计求值，杜绝死板固定相加：
 *   - SUM: 真实求和
 *   - AVG: 平均值（若行挂载了 _rawRows，优先基于全量底层事实流水做真实加权平均；否则对当前行的有效数值求算术平均）
 *   - MIN: 最小值
 *   - MAX: 最大值
 *   - COUNT: 计数（事实记录总数）
 *   - COMPUTED: 基于总计行中已汇总的基础指标，代入原公式重新求值（避免百分比/比率指标简单相加得出 >1000% 的错误数据）
 */
import type { DataRecord, OutputColumnMeta, AggregationFunction } from '../../../engine/types.js';
import { evaluateFormula } from '../../../engine/formula/evaluator.js';

function roundTo(num: number, precision?: number): number {
  if (precision === undefined) return num;
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

/**
 * 智能推断度量列的聚合类型
 */
export function inferColumnAggType(key: string, title: string): AggregationFunction {
  const upperKey = key.toUpperCase();
  const lowerTitle = title.toLowerCase();

  if (upperKey.startsWith('AVG(') || lowerTitle.includes('平均') || lowerTitle.includes('均值')) {
    return 'avg';
  }
  if (upperKey.startsWith('MIN(') || lowerTitle.includes('最小')) {
    return 'min';
  }
  if (upperKey.startsWith('MAX(') || lowerTitle.includes('最大')) {
    return 'max';
  }
  if (upperKey.startsWith('COUNT(') || lowerTitle.includes('计数') || lowerTitle.includes('总次数')) {
    return 'count';
  }
  return 'sum';
}

/**
 * 计算表格全局总计行数据
 */
export function computeSummaryValues(
  rows: readonly DataRecord[],
  columns: readonly OutputColumnMeta[],
  rawHeaders?: Record<string, string>
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (!rows || rows.length === 0) return summary;

  // 1. 搜集底层真实原始流水记录（如果由管道分组挂载）
  const allRawRows: DataRecord[] = [];
  for (const r of rows) {
    if (Array.isArray((r as any)._rawRows)) {
      allRawRows.push(...(r as any)._rawRows);
    }
  }
  const hasRawRows = allRawRows.length > 0;

  // 2. 第一阶段：计算所有非 computed 的基础度量指标
  for (const col of columns) {
    if (col.kind === 'computed') {
      continue;
    }

    if (col.type === 'number') {
      const aggType: AggregationFunction =
        col.agg || inferColumnAggType(col.key, col.title);

      if (aggType === 'sum') {
        const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
        summary[col.key] = sum;
        if (col.field) {
          summary[col.field] = sum;
          summary[`SUM(${col.field})`] = sum;
          summary[`sum(${col.field})`] = sum;
          const header = rawHeaders?.[col.field];
          if (header) {
            summary[`SUM(${header})`] = sum;
            summary[`sum(${header})`] = sum;
          }
        }
        summary[col.title] = sum;
      } else if (aggType === 'avg') {
        let avg = 0;
        if (hasRawRows && col.field) {
          // 基于底层真实事实流水计算真加权平均
          let total = 0;
          let count = 0;
          for (const raw of allRawRows) {
            const v = raw[col.field];
            if (v !== null && v !== undefined && v !== '') {
              const num = Number(v);
              if (Number.isFinite(num)) {
                total += num;
                count += 1;
              }
            }
          }
          avg = count > 0 ? total / count : 0;
        } else {
          // 兜底：对当前已汇总行的非空数值求算术平均
          let total = 0;
          let count = 0;
          for (const r of rows) {
            const v = r[col.key];
            if (v !== null && v !== undefined && v !== '') {
              const num = Number(v);
              if (Number.isFinite(num)) {
                total += num;
                count += 1;
              }
            }
          }
          avg = count > 0 ? total / count : 0;
        }
        avg = roundTo(avg, col.precision !== undefined ? col.precision : 2);
        summary[col.key] = avg;
        if (col.field) {
          summary[col.field] = avg;
          summary[`AVG(${col.field})`] = avg;
          summary[`avg(${col.field})`] = avg;
          const header = rawHeaders?.[col.field];
          if (header) {
            summary[`AVG(${header})`] = avg;
            summary[`avg(${header})`] = avg;
          }
        }
        summary[col.title] = avg;
      } else if (aggType === 'min') {
        let min = Infinity;
        for (const r of rows) {
          const v = r[col.key];
          if (v !== null && v !== undefined && v !== '') {
            const num = Number(v);
            if (Number.isFinite(num) && num < min) min = num;
          }
        }
        const minVal = min === Infinity ? 0 : min;
        summary[col.key] = minVal;
        if (col.field) {
          summary[col.field] = minVal;
          summary[`MIN(${col.field})`] = minVal;
        }
        summary[col.title] = minVal;
      } else if (aggType === 'max') {
        let max = -Infinity;
        for (const r of rows) {
          const v = r[col.key];
          if (v !== null && v !== undefined && v !== '') {
            const num = Number(v);
            if (Number.isFinite(num) && num > max) max = num;
          }
        }
        const maxVal = max === -Infinity ? 0 : max;
        summary[col.key] = maxVal;
        if (col.field) {
          summary[col.field] = maxVal;
          summary[`MAX(${col.field})`] = maxVal;
        }
        summary[col.title] = maxVal;
      } else if (aggType === 'count') {
        const count = hasRawRows
          ? allRawRows.length
          : rows.reduce((acc, r) => acc + (Number(r[col.key]) || 1), 0);
        summary[col.key] = count;
        if (col.field) {
          summary[col.field] = count;
          summary[`COUNT(${col.field})`] = count;
        }
        summary[col.title] = count;
      }
    }
  }

  // 3. 第二阶段：计算所有 computed 动态计算列（在汇总基础指标上求值）
  for (const col of columns) {
    if (col.kind === 'computed' || col.expression) {
      if (col.expression) {
        try {
          const val = evaluateFormula(col.expression, summary, { nullAsZero: true });
          const numVal =
            typeof val === 'number'
              ? roundTo(val, col.precision !== undefined ? col.precision : 2)
              : val;
          summary[col.key] = numVal;
          summary[col.title] = numVal;
        } catch {
          // 若公式在汇总上下文求值异常，针对率/占比类指标使用平均值兜底，避免固定相加
          const isRatio =
            col.key.includes('ratio') ||
            col.key.includes('rate') ||
            col.title.includes('%') ||
            col.title.includes('‰') ||
            col.title.includes('率');
          if (isRatio) {
            let total = 0;
            let count = 0;
            for (const r of rows) {
              const v = Number(r[col.key]);
              if (Number.isFinite(v)) {
                total += v;
                count += 1;
              }
            }
            const avg = count > 0 ? roundTo(total / count, col.precision ?? 2) : 0;
            summary[col.key] = avg;
          } else {
            summary[col.key] = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
          }
        }
      } else {
        // 未提供表达式的 computed 列，检查是否为率/比率
        const isRatio =
          col.key.includes('ratio') ||
          col.key.includes('rate') ||
          col.title.includes('%') ||
          col.title.includes('‰') ||
          col.title.includes('率');
        if (isRatio) {
          let total = 0;
          let count = 0;
          for (const r of rows) {
            const v = Number(r[col.key]);
            if (Number.isFinite(v)) {
              total += v;
              count += 1;
            }
          }
          summary[col.key] = count > 0 ? roundTo(total / count, col.precision ?? 2) : 0;
        } else {
          summary[col.key] = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
        }
      }
    }
  }

  return summary;
}
