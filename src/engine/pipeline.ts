/**
 * 统一聚合透视数据转换流水线 (Unified Aggregation-Pivot Transformation Pipeline)
 *
 * 核心驱动原则：
 * 1. 【三态智能仲裁】：
 *    - hasDimensions === true: 分组透视汇总 (Pivot)，按维度折叠；若包含未在维度中的固定列，以组内 FIRST_VALUE 兜底；
 *    - hasDimensions === false && (hasFixed || !hasAggregations): 全量明细增强 (Detail)，保留全量 N 条记录，度量自动降级为当前行原值；
 *    - hasDimensions === false && !hasFixed && hasAggregations: 全局总计卡片 (Summary)，折叠为 1 行全表总计；
 * 2. 汇总行中同时挂载原始字段与 SUM/AVG 宏别名，公式中无论是 [sales] 还是 [SUM(sales)] 均可直接求值。
 */
import type { DataRecord } from '../types.js';
import type {
  DynamicTransformConfig,
  TransformResult,
  OutputColumnMeta,
  ComputedColumnConfig,
  AggregatedColumnConfig,
  FixedColumnConfig,
  FieldDataType,
} from './types.js';
import { formatTimeBucket } from './bucketing.js';
import { evaluateFormula, evaluateAST } from './formula/evaluator.js';
import { parseFormula } from './formula/parser.js';
import { isLikelyDateValue, isLikelyNumericValue } from './profiler.js';

interface MetricAccumulator {
  sum: number;
  count: number;
  min: number;
  max: number;
}

function roundTo(num: number, precision?: number): number {
  if (precision === undefined || precision === null) return num;
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

/**
 * 判断计算列是否应在行级（阶段1）执行
 */
function isRowLevelComputed(col: ComputedColumnConfig, shouldAggregate: boolean): boolean {
  if (!shouldAggregate) return true;
  if (col.scope === 'row') return true;
  if (col.scope === 'summary') return false;
  // auto: 若包含聚合宏函数，或者进入了聚合模式，归入汇总阶段执行
  const exprUpper = col.expression.toUpperCase();
  if (
    exprUpper.includes('SUM(') ||
    exprUpper.includes('AVG(') ||
    exprUpper.includes('COUNT(') ||
    exprUpper.includes('MIN(') ||
    exprUpper.includes('MAX(')
  ) {
    return false;
  }
  return false;
}

/**
 * 执行完整的数据转换流程
 */
export function transformData(
  records: readonly DataRecord[],
  config: DynamicTransformConfig
): TransformResult {
  const startTime = Date.now();
  const nullAsZero = config.options?.nullAsZero ?? true;

  if (!records || records.length === 0) {
    return {
      data: [],
      columns: [],
      meta: {
        form: 'detail',
        inputRows: 0,
        outputRows: 0,
        executionTimeMs: 0,
      },
    };
  }

  // 1. 三态智能仲裁判定 (Three-state Disambiguation Decision)
  const timeBucketConfig = config.dimensions?.timeBucket;
  const categoryDims = config.dimensions?.categories ?? [];
  const hasTimeBucket = Boolean(timeBucketConfig && timeBucketConfig.field);
  const hasCategories = Boolean(categoryDims.length > 0);
  const hasDimensions = hasTimeBucket || hasCategories;
  const hasFixed = config.columns.some((c) => c.type === 'fixed');
  const hasAggregations = config.columns.some((c) => c.type === 'aggregated');

  /**
   * 智能仲裁规则：
   * 1. 配置了维度 -> pivot 分组透视；
   * 2. 未配置维度：
   *    - 若包含固定原值列 (hasFixed) 或 未配聚合度量 (!hasAggregations):
   *      -> 裁定为 detail 全量明细增强！输出全部 N 行明细，度量自动降级为行原值，绝不折叠为1行，绝无 '-'；
   *    - 若既无维度，也无任何固定列（全为纯聚合度量）:
   *      -> 裁定为 summary 全局总计卡片！折叠为 1 行全店汇总。
   */
  const executionForm: 'detail' | 'pivot' | 'summary' = hasDimensions
    ? 'pivot'
    : hasFixed || !hasAggregations
    ? 'detail'
    : 'summary';

  const shouldAggregate = executionForm !== 'detail';

  // 2. 区分计算列的执行阶段
  const allComputedCols = config.columns.filter(
    (c): c is ComputedColumnConfig => c.type === 'computed'
  );
  const rowComputedCols = allComputedCols.filter((c) => isRowLevelComputed(c, shouldAggregate));
  const summaryComputedCols = allComputedCols.filter((c) => !isRowLevelComputed(c, shouldAggregate));

  // 预编译计算列 AST 树，消除在循环中重复解析公式的 CPU 开销
  const compiledRowCols = rowComputedCols.map((comp) => {
    try {
      return { comp, ast: parseFormula(comp.expression) };
    } catch {
      return { comp, ast: null };
    }
  });

  const compiledSummaryCols = summaryComputedCols.map((comp) => {
    try {
      return { comp, ast: parseFormula(comp.expression) };
    } catch {
      return { comp, ast: null };
    }
  });

  // =========================================================================
  // 【阶段 1】行级计算增强 (Row Transform)
  // =========================================================================
  const aggCols = config.columns.filter(
    (c): c is AggregatedColumnConfig => c.type === 'aggregated'
  );

  const enhancedRows: DataRecord[] = records.map((rawRow) => {
    const row: DataRecord = { ...rawRow };

    // 挂载表头标签别名，确保公式引用 [销售额] 或 [sales] 都能取到值
    if (config.headers) {
      for (const [k, lbl] of Object.entries(config.headers)) {
        if (k in row && !(lbl in row)) {
          row[lbl] = row[k];
        }
      }
    }

    // 为列中配置的所有聚合度量字段挂载当前行原值别名（例如 SUM(sales) = row.sales）
    for (const aggCol of aggCols) {
      const rawVal = row[aggCol.field];
      const numVal =
        typeof rawVal === 'number'
          ? rawVal
          : rawVal === null || rawVal === undefined || rawVal === ''
          ? nullAsZero
            ? 0
            : NaN
          : Number(rawVal);
      const valToSet = Number.isFinite(numVal) ? numVal : rawVal;

      const key = `${aggCol.agg.toUpperCase()}(${aggCol.field})`;
      row[key] = valToSet;
      row[`${aggCol.agg.toLowerCase()}(${aggCol.field})`] = valToSet;

      if (aggCol.label && !(aggCol.label in row)) {
        row[aggCol.label] = valToSet;
      }
    }

    for (const { comp, ast } of compiledRowCols) {
      if (!ast) {
        row[comp.name] = null;
        continue;
      }
      try {
        const val = evaluateAST(ast, row, { nullAsZero });
        row[comp.name] =
          typeof val === 'number' && comp.precision !== undefined
            ? roundTo(val, comp.precision)
            : val;
        if (comp.label && !(comp.label in row)) {
          row[comp.label] = row[comp.name];
        }
      } catch {
        row[comp.name] = null;
      }
    }
    return row;
  });

  let outputRows: DataRecord[] = [];

  // =========================================================================
  // 【阶段 2 & 3】分组透视汇总 或 全量明细输出
  // =========================================================================
  if (executionForm === 'detail') {
    // 场景 A: 裁定为全量明细输出（N 行全部保留，逐行计算）
    for (const { comp, ast } of compiledSummaryCols) {
      for (const row of enhancedRows) {
        if (!ast) {
          row[comp.name] = null;
          continue;
        }
        try {
          const val = evaluateAST(ast, row, { nullAsZero });
          row[comp.name] =
            typeof val === 'number' && comp.precision !== undefined
              ? roundTo(val, comp.precision)
              : val;
          if (comp.label && !(comp.label in row)) {
            row[comp.label] = row[comp.name];
          }
        } catch {
          row[comp.name] = null;
        }
      }
    }
    for (let i = 0; i < enhancedRows.length; i++) {
      const row = enhancedRows[i]!;
      const rawRecord = records[i] || row;
      Object.defineProperty(row, '_rawRows', {
        value: [rawRecord],
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    outputRows = enhancedRows;
  } else {
    // 场景 B & C: 分组折叠透视汇总 (Pivot) 或 全局单行汇总 (Summary)
    const sampleRecord = enhancedRows[0] || {};
    const metricFieldsToTrack = new Set<string>();
    for (const aggCol of aggCols) {
      metricFieldsToTrack.add(aggCol.field);
    }
    for (const [k, v] of Object.entries(sampleRecord)) {
      if (typeof v === 'number' || (typeof v === 'string' && !Number.isNaN(Number(v)) && v.trim() !== '')) {
        metricFieldsToTrack.add(k);
      }
    }

    // 分组 Map: groupKey -> { dimValues, metrics, childRows }
    const groupMap = new Map<
      string,
      {
        dimValues: Record<string, unknown>;
        metrics: Map<string, MetricAccumulator>;
        childRows: DataRecord[];
      }
    >();

    for (let i = 0; i < enhancedRows.length; i++) {
      const row = enhancedRows[i]!;
      const rawRecord = records[i] || row;
      const dimValues: Record<string, unknown> = {};

      if (hasDimensions) {
        if (timeBucketConfig && timeBucketConfig.field) {
          const bucketVal = formatTimeBucket(row[timeBucketConfig.field], timeBucketConfig);
          dimValues[timeBucketConfig.field] = bucketVal;
        }
        for (const cat of categoryDims) {
          dimValues[cat] = row[cat] ?? '(空)';
        }
      }

      const groupKey = hasDimensions
        ? Object.entries(dimValues)
            .map(([k, v]) => `${k}:${String(v)}`)
            .join('###')
        : '__GLOBAL_SUMMARY__';

      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          dimValues,
          metrics: new Map<string, MetricAccumulator>(),
          childRows: [],
        };
        groupMap.set(groupKey, group);
      }
      group.childRows.push(rawRecord);

      // 指标累加
      for (const metricField of metricFieldsToTrack) {
        let acc = group.metrics.get(metricField);
        if (!acc) {
          acc = { sum: 0, count: 0, min: Infinity, max: -Infinity };
          group.metrics.set(metricField, acc);
        }

        const rawVal = row[metricField];
        // 在分组聚合累加阶段，null/undefined/空字符串表示数据缺失，在 BI/SQL 聚合规则中必须跳过，绝不能当成数值 0 去污染 min/count/avg
        if (rawVal === null || rawVal === undefined || rawVal === '') {
          continue;
        }

        const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal);

        if (Number.isFinite(numVal)) {
          acc.sum += numVal;
          acc.count += 1;
          if (numVal < acc.min) acc.min = numVal;
          if (numVal > acc.max) acc.max = numVal;
        } else {
          // 非数字类型（如文本 ID 字段）进行计数统计
          acc.count += 1;
        }
      }
    }

    // 生成汇总行 (Summary Rows)
    const summaryRows: DataRecord[] = [];

    for (const group of groupMap.values()) {
      const summaryRow: DataRecord = { ...group.dimValues };

      // 1. 如果配置了固定原值列，但未在维度中声明，采用类似 SQL FIRST_VALUE 语义兜底取该组首条样本记录的值，防止出现 '-' 空值
      const fixedCols = config.columns.filter((c): c is FixedColumnConfig => c.type === 'fixed');
      for (const fixCol of fixedCols) {
        if (!(fixCol.field in summaryRow)) {
          const firstVal = group.childRows[0]?.[fixCol.field];
          if (firstVal !== undefined && firstVal !== null) {
            summaryRow[fixCol.field] = firstVal;
          }
        }
      }

      // 2. 填充指标计算值：同时提供 SUM/AVG/MIN/MAX/COUNT 及原字段名
      for (const [metricField, acc] of group.metrics.entries()) {
        const finalSum = acc.sum;
        const finalAvg = acc.count > 0 ? acc.sum / acc.count : 0;
        const finalMin = acc.min === Infinity ? 0 : acc.min;
        const finalMax = acc.max === -Infinity ? 0 : acc.max;
        const finalCount = acc.count;

        // 大写聚合宏
        summaryRow[`SUM(${metricField})`] = finalSum;
        summaryRow[`AVG(${metricField})`] = finalAvg;
        summaryRow[`MIN(${metricField})`] = finalMin;
        summaryRow[`MAX(${metricField})`] = finalMax;
        summaryRow[`COUNT(${metricField})`] = finalCount;

        // 小写聚合宏
        summaryRow[`sum(${metricField})`] = finalSum;
        summaryRow[`avg(${metricField})`] = finalAvg;
        summaryRow[`min(${metricField})`] = finalMin;
        summaryRow[`max(${metricField})`] = finalMax;
        summaryRow[`count(${metricField})`] = finalCount;

        // 挂载原字段名，支持公式直接以 [sales] 引用汇总值
        if (!(metricField in summaryRow)) {
          summaryRow[metricField] = finalSum;
        }

        // 中文表头映射别名挂载
        const label = config.headers?.[metricField];
        if (label) {
          summaryRow[`SUM(${label})`] = finalSum;
          summaryRow[`AVG(${label})`] = finalAvg;
          summaryRow[`MIN(${label})`] = finalMin;
          summaryRow[`MAX(${label})`] = finalMax;
          summaryRow[`COUNT(${label})`] = finalCount;

          summaryRow[`sum(${label})`] = finalSum;
          summaryRow[`avg(${label})`] = finalAvg;
          summaryRow[`min(${label})`] = finalMin;
          summaryRow[`max(${label})`] = finalMax;
          summaryRow[`count(${label})`] = finalCount;

          if (!(label in summaryRow)) {
            summaryRow[label] = finalSum;
          }
        }
      }

      // 如果用户显式配置了某一聚合列并且指定了非 sum 聚合或自定义了 label，精准挂载
      for (const aggCol of aggCols) {
        const acc = group.metrics.get(aggCol.field);
        if (acc) {
          let customVal: unknown = 0;
          switch (aggCol.agg) {
            case 'sum': customVal = acc.sum; break;
            case 'avg': customVal = acc.count > 0 ? acc.sum / acc.count : 0; break;
            case 'min': customVal = acc.min === Infinity ? 0 : acc.min; break;
            case 'max': customVal = acc.max === -Infinity ? 0 : acc.max; break;
            case 'count': customVal = acc.count; break;
          }
          const key = `${aggCol.agg.toUpperCase()}(${aggCol.field})`;
          summaryRow[key] = customVal;
          summaryRow[`${aggCol.agg.toLowerCase()}(${aggCol.field})`] = customVal;
          if (aggCol.label) {
            summaryRow[aggCol.label] = customVal;
          }
          // 挂载原字段名，确保直接以 [field] 引用的公式与下游消费均能取到选定的聚合值
          summaryRow[aggCol.field] = customVal;
        }
      }

      // 阶段 3：汇总后动态指标计算
      for (const { comp, ast } of compiledSummaryCols) {
        if (!ast) {
          summaryRow[comp.name] = null;
          continue;
        }
        try {
          const val = evaluateAST(ast, summaryRow, { nullAsZero });
          summaryRow[comp.name] =
            typeof val === 'number' && comp.precision !== undefined
              ? roundTo(val, comp.precision)
              : val;
          if (comp.label && !(comp.label in summaryRow)) {
            summaryRow[comp.label] = summaryRow[comp.name];
          }
        } catch {
          summaryRow[comp.name] = null;
        }
      }

      // 挂载贡献给该聚合桶的底层全部真实原始流水记录 (不可枚举属性，避免污染 Object.keys 与图表遍历)
      Object.defineProperty(summaryRow, '_rawRows', {
        value: group.childRows,
        enumerable: false,
        writable: true,
        configurable: true,
      });

      summaryRows.push(summaryRow);
    }

    outputRows = summaryRows;
  }

  // =========================================================================
  // 排序处理
  // =========================================================================
  if (config.options?.sort && config.options.sort.length > 0) {
    const sorts = config.options.sort;
    outputRows.sort((a, b) => {
      for (const s of sorts) {
        const valA = a[s.field];
        const valB = b[s.field];
        if (valA === valB) continue;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        const comp = valA > valB ? 1 : -1;
        return s.order === 'desc' ? -comp : comp;
      }
      return 0;
    });
  }

  // =========================================================================
  // 生成输出列元信息定义 (Output Columns)
  // =========================================================================
  const outputCols: OutputColumnMeta[] = [];
  const addedKeys = new Set<string>();

  // 1. 如果有维度，优先展示维度列
  if (hasDimensions && config.dimensions) {
    if (config.dimensions.timeBucket?.field) {
      const f = config.dimensions.timeBucket.field;
      const label = config.headers?.[f] || f;
      outputCols.push({
        key: f,
        title: label,
        type: 'time',
        kind: 'dimension',
        field: f,
      });
      addedKeys.add(f);
    }
    if (config.dimensions.categories) {
      for (const cat of config.dimensions.categories) {
        if (!addedKeys.has(cat)) {
          const label = config.headers?.[cat] || cat;
          outputCols.push({
            key: cat,
            title: label,
            type: 'text',
            kind: 'dimension',
            field: cat,
          });
          addedKeys.add(cat);
        }
      }
    }
  }

  // 2. 根据 columns 配置生成
  for (const col of config.columns) {
    if (col.type === 'fixed') {
      const fixCol = col as FixedColumnConfig;
      if (!addedKeys.has(fixCol.field)) {
        let fieldType: FieldDataType = config.fields?.[fixCol.field] || 'text';
        if (!config.fields?.[fixCol.field]) {
          const sampleVal = records.find(
            (r) => r[fixCol.field] !== null && r[fixCol.field] !== undefined
          )?.[fixCol.field];
          if (isLikelyNumericValue(sampleVal)) {
            fieldType = 'number';
          } else if (isLikelyDateValue(sampleVal)) {
            fieldType = 'time';
          }
        }
        outputCols.push({
          key: fixCol.field,
          title: fixCol.label || config.headers?.[fixCol.field] || fixCol.field,
          type: fieldType,
          kind: 'fixed',
          field: fixCol.field,
        });
        addedKeys.add(fixCol.field);
      }
    } else if (col.type === 'aggregated') {
      const aggCol = col as AggregatedColumnConfig;
      const key = `${aggCol.agg.toUpperCase()}(${aggCol.field})`;
      const fieldTitle = config.headers?.[aggCol.field] || aggCol.field;
      const defaultTitle = `${aggCol.agg.toUpperCase()}(${fieldTitle})`;
      if (!addedKeys.has(key)) {
        outputCols.push({
          key,
          title: aggCol.label || defaultTitle,
          type: 'number',
          kind: 'aggregated',
          agg: aggCol.agg,
          field: aggCol.field,
        });
        addedKeys.add(key);
      }
    } else if (col.type === 'computed') {
      const compCol = col as ComputedColumnConfig;
      if (!addedKeys.has(compCol.name)) {
        outputCols.push({
          key: compCol.name,
          title: compCol.label || compCol.name,
          type: 'number',
          kind: 'computed',
          expression: compCol.expression,
          precision: compCol.precision,
        });
        addedKeys.add(compCol.name);
      }
    }
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    data: outputRows,
    columns: outputCols,
    meta: {
      form: executionForm,
      inputRows: records.length,
      outputRows: outputRows.length,
      executionTimeMs,
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
      rawHeaders: config.headers,
    },
  };
}
