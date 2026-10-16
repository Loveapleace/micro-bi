/**
 * 报表切片度量与公式计算器 (calculateMetrics.ts)
 * 纯计算模块，无 UI 与 DOM 依赖。
 * 提供对单桶/叶子切片/总计切片的度量求值与格式化。
 *
 * MBI-08 修复：行级计算列按配置顺序依次执行，上下文逐层传递，
 * 保证后序计算列能引用前序计算列的求值结果。
 */
import type { DataRecord } from '../engine/types.js';
import type { NormalizedMetric } from './normalizeAxes.js';
import { roundTo } from '../engine/summary.js';
import { evaluateFormula } from '../engine/formula/evaluator.js';

export interface EvaluatedMetricResult {
  value: number | string | boolean | null;
  displayText: string;
}

/**
 * 按行依次增强记录：
 * 1. 注入表头别名 (如 rawHeaders: { sales: '销售额' } 则 row['销售额'] = row.sales)
 * 2. 注入聚合度量原值别名 (如 SUM(qty) = row.qty, avg(qty) = row.qty)
 * 3. 顺序求值 row 作用域计算列，并将求值结果回写到行对象中供后续计算列引用 (MBI-08)
 */
export function enhanceRecordsWithRowComputed(
  records: readonly DataRecord[],
  metrics: readonly NormalizedMetric[],
  rawHeaders: Record<string, string> = {}
): DataRecord[] {
  if (!records || records.length === 0) return [];

  const rowComputedMetrics = metrics.filter(
    (m) => m.kind === 'computed' && m.scope === 'row'
  );

  return records.map((rawRow) => {
    const row: DataRecord = { ...rawRow };

    // 1. 注入表头别名
    for (const [k, lbl] of Object.entries(rawHeaders)) {
      if (k in row && !(lbl in row)) {
        row[lbl] = row[k];
      }
    }

    // 2. 为聚合度量字段挂载当前行原值别名 (如 SUM(qty) = row.qty)
    for (const m of metrics) {
      if (m.kind === 'aggregated' && m.field) {
        const rawVal = row[m.field];
        const numVal =
          typeof rawVal === 'number'
            ? rawVal
            : rawVal === null || rawVal === undefined || rawVal === ''
            ? 0
            : Number(rawVal);
        const valToSet = Number.isFinite(numVal) ? numVal : rawVal;
        const keyUpper = `${m.agg?.toUpperCase()}(${m.field})`;
        const keyLower = `${m.agg?.toLowerCase()}(${m.field})`;
        row[keyUpper] = valToSet;
        row[keyLower] = valToSet;
        if (m.label && !(m.label in row)) {
          row[m.label] = valToSet;
        }
      }
    }

    // 3. 顺序求值 row 作用域计算列，逐层传递上下文 (MBI-08)
    for (const m of rowComputedMetrics) {
      if (!m.expression) {
        row[m.id] = null;
        if (m.label) row[m.label] = null;
        continue;
      }
      try {
        const v = evaluateFormula(m.expression, row, { nullAsZero: true });
        const finalVal =
          typeof v === 'number' && m.precision !== undefined
            ? roundTo(v, m.precision)
            : v;
        row[m.id] = finalVal;
        if (m.label && !(m.label in row)) {
          row[m.label] = finalVal;
        }
      } catch {
        row[m.id] = null;
        if (m.label && !(m.label in row)) {
          row[m.label] = null;
        }
      }
    }

    return row;
  });
}

export function evaluateMetricsForBucket(
  records: readonly DataRecord[],
  metrics: readonly NormalizedMetric[],
  rawHeaders: Record<string, string> = {}
): Map<string, EvaluatedMetricResult> {
  const results = new Map<string, EvaluatedMetricResult>();
  if (!records || records.length === 0) {
    for (const m of metrics) {
      if (m.kind === 'aggregated' && m.agg === 'count') {
        results.set(m.id, { value: 0, displayText: '0' });
      } else {
        results.set(m.id, { value: null, displayText: '-' });
      }
    }
    return results;
  }

  // 预先执行行级增强 (MBI-08)
  const enhancedRecords = enhanceRecordsWithRowComputed(records, metrics, rawHeaders);

  // 1. 统计所有字段的聚合量（sum, numericCount, nonNullCount, min, max）
  const fieldStats = new Map<
    string,
    {
      sum: number;
      numericCount: number;
      nonNullCount: number;
      min: number;
      max: number;
    }
  >();

  const getStats = (field: string) => {
    let s = fieldStats.get(field);
    if (!s) {
      s = { sum: 0, numericCount: 0, nonNullCount: 0, min: Infinity, max: -Infinity };
      fieldStats.set(field, s);
    }
    return s;
  };

  for (const row of enhancedRecords) {
    for (const [key, val] of Object.entries(row)) {
      if (key.startsWith('_')) continue;
      const s = getStats(key);
      if (val !== null && val !== undefined && val !== '') {
        s.nonNullCount += 1;
        const num = Number(val);
        if (Number.isFinite(num)) {
          s.sum += num;
          s.numericCount += 1;
          if (num < s.min) s.min = num;
          if (num > s.max) s.max = num;
        }
      }
    }
  }

  // 2. 准备公式求值上下文
  const evalContext: Record<string, unknown> = {};
  for (const [field, s] of fieldStats) {
    const avg = s.numericCount > 0 ? s.sum / s.numericCount : 0;
    const min = s.min === Infinity ? 0 : s.min;
    const max = s.max === -Infinity ? 0 : s.max;

    evalContext[field] = s.sum;
    evalContext[`SUM(${field})`] = s.sum;
    evalContext[`sum(${field})`] = s.sum;
    evalContext[`AVG(${field})`] = avg;
    evalContext[`avg(${field})`] = avg;
    evalContext[`COUNT(${field})`] = s.nonNullCount;
    evalContext[`count(${field})`] = s.nonNullCount;
    evalContext[`MIN(${field})`] = min;
    evalContext[`min(${field})`] = min;
    evalContext[`MAX(${field})`] = max;
    evalContext[`max(${field})`] = max;

    const label = rawHeaders[field];
    if (label) {
      evalContext[label] = s.sum;
      evalContext[`SUM(${label})`] = s.sum;
      evalContext[`sum(${label})`] = s.sum;
      evalContext[`AVG(${label})`] = avg;
      evalContext[`avg(${label})`] = avg;
      evalContext[`COUNT(${label})`] = s.nonNullCount;
      evalContext[`count(${label})`] = s.nonNullCount;
      evalContext[`MIN(${label})`] = min;
      evalContext[`min(${label})`] = min;
      evalContext[`MAX(${label})`] = max;
      evalContext[`max(${label})`] = max;
    }
  }

  // 3. 第一阶段：计算基础度量（aggregated 和 fixed）
  for (const m of metrics) {
    if (m.kind === 'aggregated') {
      const field = m.field || '';
      const s = getStats(field);
      const agg = m.agg || 'sum';
      let val = 0;
      if (agg === 'sum') {
        val = s.sum;
      } else if (agg === 'count') {
        val = s.nonNullCount;
      } else if (agg === 'avg') {
        val = s.numericCount > 0 ? s.sum / s.numericCount : 0;
        val = roundTo(val, m.precision ?? 2);
      } else if (agg === 'min') {
        val = s.min === Infinity ? 0 : s.min;
      } else if (agg === 'max') {
        val = s.max === -Infinity ? 0 : s.max;
      }

      evalContext[m.id] = val;
      evalContext[m.label] = val;
      evalContext[`${agg.toUpperCase()}(${field})`] = val;

      results.set(m.id, {
        value: val,
        displayText: String(val),
      });
    } else if (m.kind === 'fixed') {
      const field = m.field || '';
      const rawVal = enhancedRecords[0]?.[field] ?? null;
      results.set(m.id, {
        value: (rawVal as any) ?? null,
        displayText: rawVal !== null && rawVal !== undefined ? String(rawVal) : '',
      });
    }
  }

  // 4. 第二阶段：计算 computed 指标
  for (const m of metrics) {
    if (m.kind === 'computed') {
      let val: number | string | boolean | null = null;
      if (m.scope === 'row' && m.expression) {
        // 行级计算列的总和直接累计已增强好的行结果 (MBI-08)
        let sum = 0;
        for (const row of enhancedRecords) {
          const rowVal = row[m.id] ?? row[m.label];
          if (typeof rowVal === 'number' && Number.isFinite(rowVal)) {
            sum += rowVal;
          }
        }
        val = roundTo(sum, m.precision ?? 2);
      } else if (m.expression) {
        try {
          const res = evaluateFormula(m.expression, evalContext, { nullAsZero: true });
          if (typeof res === 'number') {
            val = roundTo(res, m.precision ?? 2);
          } else {
            val = (res as any) ?? null;
          }
        } catch {
          val = 0;
        }
      }

      evalContext[m.id] = val;
      evalContext[m.label] = val;

      // 生成显示文本（若为率/百分比且为数值，保留百分比格式）
      const isRatio =
        m.id.includes('%') ||
        m.label.includes('%') ||
        m.id.includes('率') ||
        m.label.includes('率') ||
        m.id.toLowerCase().includes('rate') ||
        m.id.toLowerCase().includes('ratio');

      let displayText = val !== null ? String(val) : '';
      if (typeof val === 'number') {
        if (isRatio) {
          if (m.expression && m.expression.includes('* 100')) {
            displayText = `${val.toFixed(m.precision ?? 2)}%`;
          } else if (val <= 1 && val >= 0) {
            displayText = `${(val * 100).toFixed(m.precision ?? 2)}%`;
          } else {
            displayText = `${val.toFixed(m.precision ?? 2)}%`;
          }
        } else {
          displayText = String(val);
        }
      }

      results.set(m.id, {
        value: val,
        displayText,
      });
    }
  }

  return results;
}
