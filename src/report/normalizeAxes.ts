/**
 * 报表轴规范化与别名隔离模块 (normalizeAxes.ts)
 * 纯数据层，负责将 DynamicTransformConfig 规范化为统一的双轴与指标结构。
 * 特别处理：
 * 1. 同一时间字段在行轴与列轴不同粒度时的执行别名隔离（如 row: __row_time__, col: __col_time__）；
 * 2. 指标方向规范化（indicatorsAsCol 默认为 true）；
 * 3. 维度总计与小计配置规范化；
 * 4. 指标元数据规范化。
 */
import type {
  DynamicTransformConfig,
  TimeBucketConfig,
  DimensionTotalsConfig,
  AggregationFunction,
} from '../engine/types.js';

export interface NormalizedDimension {
  id: string;
  field: string;
  alias: string;
  label: string;
  axis: 'row' | 'col';
  isTime?: boolean;
  timeConfig?: TimeBucketConfig;
}

export interface NormalizedMetric {
  id: string;
  field?: string | undefined;
  label: string;
  agg?: AggregationFunction | undefined;
  kind: 'aggregated' | 'computed' | 'fixed';
  expression?: string | undefined;
  scope?: 'row' | 'summary' | 'auto' | undefined;
  precision?: number | undefined;
}

export interface NormalizedAxes {
  isCrossTab: boolean;
  indicatorsAsCol: boolean;
  executionForm: 'detail' | 'pivot' | 'summary';
  rowAxes: NormalizedDimension[];
  colAxes: NormalizedDimension[];
  metrics: NormalizedMetric[];
  rowTotals: DimensionTotalsConfig;
  colTotals: DimensionTotalsConfig;
  rawHeaders: Record<string, string>;
  options?: DynamicTransformConfig['options'] | undefined;
}

export function normalizeAxes(
  config: DynamicTransformConfig,
  rawHeaders: Record<string, string> = {}
): NormalizedAxes {
  const dim = config.dimensions || {};
  const rowAxes: NormalizedDimension[] = [];
  const colAxes: NormalizedDimension[] = [];

  // 1. 行轴规范化
  if (dim.timeBucket) {
    const field = dim.timeBucket.field;
    rowAxes.push({
      id: `row_time_${field}`,
      field,
      alias: `__row_time_${field}__`,
      label: rawHeaders[field] || field,
      axis: 'row',
      isTime: true,
      timeConfig: dim.timeBucket,
    });
  }
  if (dim.categories && dim.categories.length > 0) {
    for (const cat of dim.categories) {
      rowAxes.push({
        id: `row_cat_${cat}`,
        field: cat,
        alias: `__row_cat_${cat}__`,
        label: rawHeaders[cat] || cat,
        axis: 'row',
      });
    }
  }

  // 2. 列轴规范化
  if (dim.columnTimeBucket) {
    const field = dim.columnTimeBucket.field;
    colAxes.push({
      id: `col_time_${field}`,
      field,
      alias: `__col_time_${field}__`,
      label: rawHeaders[field] || field,
      axis: 'col',
      isTime: true,
      timeConfig: dim.columnTimeBucket,
    });
  }
  if (dim.columnCategories && dim.columnCategories.length > 0) {
    for (const cat of dim.columnCategories) {
      colAxes.push({
        id: `col_cat_${cat}`,
        field: cat,
        alias: `__col_cat_${cat}__`,
        label: rawHeaders[cat] || cat,
        axis: 'col',
      });
    }
  }

  // 3. 指标规范化 (MBI-06: 指标身份与标题彻底分离，杜绝同名标题互相覆盖)
  const metrics: NormalizedMetric[] = [];
  for (const col of config.columns || []) {
    if (col.type === 'aggregated') {
      const field = col.field;
      const defaultLabel = `${col.agg.toUpperCase()}(${rawHeaders[field] || field})`;
      const baseId = `${col.agg.toUpperCase()}(${field})`;
      let id = baseId;
      let counter = 1;
      while (metrics.some((m) => m.id === id)) {
        counter++;
        id = `${baseId}_${counter}`;
      }
      metrics.push({
        id,
        field: col.field,
        label: col.label || defaultLabel,
        agg: col.agg,
        kind: 'aggregated',
        ...((col as any).precision !== undefined ? { precision: (col as any).precision } : {}),
      });
    } else if (col.type === 'computed') {
      const baseId = col.name;
      let id = baseId;
      let counter = 1;
      while (metrics.some((m) => m.id === id)) {
        counter++;
        id = `${baseId}_${counter}`;
      }
      metrics.push({
        id,
        label: col.label || col.name,
        kind: 'computed',
        expression: col.expression,
        scope: col.scope || 'summary',
        precision: col.precision,
      });
    } else if (col.type === 'fixed') {
      const baseId = col.field;
      let id = baseId;
      let counter = 1;
      while (metrics.some((m) => m.id === id)) {
        counter++;
        id = `${baseId}_${counter}`;
      }
      metrics.push({
        id,
        field: col.field,
        label: col.label || rawHeaders[col.field] || col.field,
        kind: 'fixed',
      });
    }
  }

  const isCrossTab = colAxes.length > 0;
  const indicatorsAsCol = dim.indicatorsAsCol !== false; // 默认为 true

  // 智能三态仲裁 (MBI-07: 统一引擎 detail / pivot / summary 判定)
  const hasDimensions = rowAxes.length > 0 || colAxes.length > 0;
  const hasFixed = (config.columns || []).some((c) => c.type === 'fixed');
  const hasAggregations = (config.columns || []).some((c) => c.type === 'aggregated');
  const executionForm: 'detail' | 'pivot' | 'summary' = hasDimensions
    ? 'pivot'
    : hasFixed || !hasAggregations
    ? 'detail'
    : 'summary';

  const defaultTotals: DimensionTotalsConfig = {
    showGrandTotals: true,
    showSubTotals: false,
    grandTotalLabel: '总计',
    subTotalLabel: '小计',
  };

  const rowTotals: DimensionTotalsConfig = {
    showGrandTotals: dim.rowTotals?.showGrandTotals ?? defaultTotals.showGrandTotals,
    showSubTotals: dim.rowTotals?.showSubTotals ?? defaultTotals.showSubTotals,
    grandTotalLabel: dim.rowTotals?.grandTotalLabel || defaultTotals.grandTotalLabel,
    subTotalLabel: dim.rowTotals?.subTotalLabel || defaultTotals.subTotalLabel,
  };

  const colTotals: DimensionTotalsConfig = {
    showGrandTotals: dim.columnTotals?.showGrandTotals ?? defaultTotals.showGrandTotals,
    showSubTotals: dim.columnTotals?.showSubTotals ?? defaultTotals.showSubTotals,
    grandTotalLabel: dim.columnTotals?.grandTotalLabel || defaultTotals.grandTotalLabel,
    subTotalLabel: dim.columnTotals?.subTotalLabel || defaultTotals.subTotalLabel,
  };

  return {
    isCrossTab,
    indicatorsAsCol,
    executionForm,
    rowAxes,
    colAxes,
    metrics,
    rowTotals,
    colTotals,
    rawHeaders,
    options: config.options,
  };
}
