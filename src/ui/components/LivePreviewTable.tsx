import React from 'react';
import { Card, Tag, Space, Typography, Badge } from 'antd';
import { TableOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TransformResult, DynamicTransformConfig, DataRecord, OutputColumnMeta, AggregationFunction } from '../../engine/types.js';
import { evaluateFormula } from '../../engine/formula/evaluator.js';
import { computeSummaryValues, inferColumnAggType } from '../presentation/table/summaryCalculator.js';
import { useDynamicDataLocale } from '../../locale/index.js';

const { Text } = Typography;

export interface LivePreviewTableProps {
  readonly result?: TransformResult | undefined;
  readonly loading?: boolean | undefined;
  readonly config?: DynamicTransformConfig | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly showFieldKeys?: boolean | undefined;
}

interface DimTuple {
  key: string;
  label: string;
  values: Record<string, unknown>;
}

function roundTo(num: number, precision?: number): number {
  if (precision === undefined) return num;
  const factor = 10 ** precision;
  return Math.round(num * factor) / factor;
}

function getColumnAggType(col: OutputColumnMeta, config?: DynamicTransformConfig): AggregationFunction {
  if (col.agg) {
    return col.agg.toLowerCase() as AggregationFunction;
  }
  if (config?.columns) {
    const matched = config.columns.find((c: any) =>
      c.label === col.title || c.field === col.field || c.field === col.key || c.name === col.key
    );
    if (matched && (matched as any).agg) {
      return (matched as any).agg.toLowerCase() as AggregationFunction;
    }
  }
  return inferColumnAggType(col.key, col.title || col.key);
}

function aggregateValues(
  values: number[],
  aggType: AggregationFunction,
  precision?: number
): number {
  if (values.length === 0) return 0;
  let res = 0;
  if (aggType === 'sum') {
    res = values.reduce((acc, v) => acc + v, 0);
  } else if (aggType === 'avg') {
    res = values.reduce((acc, v) => acc + v, 0) / values.length;
  } else if (aggType === 'min') {
    res = Math.min(...values);
  } else if (aggType === 'max') {
    res = Math.max(...values);
  } else if (aggType === 'count') {
    res = values.length;
  } else {
    res = values.reduce((acc, v) => acc + v, 0);
  }
  return roundTo(res, precision !== undefined ? precision : 2);
}

/**
 * 格式化单元格数值
 */
function formatValue(val: unknown, precision?: number): React.ReactNode {
  if (val === null || val === undefined) {
    return <Text type="secondary">-</Text>;
  }
  if (typeof val === 'number') {
    let formatted: string;
    if (precision !== undefined) {
      if (precision === 0) {
        formatted = Math.round(val).toLocaleString();
      } else {
        formatted = val.toLocaleString(undefined, {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        });
      }
    } else if (Number.isInteger(val)) {
      formatted = val.toLocaleString();
    } else {
      formatted = val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'Consolas, monospace' }}>{formatted}</span>;
  }
  return String(val);
}

/**
 * 实时试算预览表格
 *
 * 采用原生 HTML5 高性能表格与轻量 CSS，彻底剥离 antd/Table 与 rc-table / rc-pagination，
 * 消除数百 KB 冗余体积与虚拟列表初始化负担，前 10 行预览纳秒级直出。
 * 支持双向多维交叉透视表 (Cross-Tab Pivot) 2D 复合矩阵与 1D 扁平交集数据无缝双视图切换。
 */
export const LivePreviewTable: React.FC<LivePreviewTableProps> = ({
  result,
  loading = false,
  config,
  headers: propHeaders,
  showFieldKeys = false,
}) => {
  const t = useDynamicDataLocale();
  const data = result?.data ?? [];
  const columnsMeta = result?.columns ?? [];
  const meta = result?.meta;
  const isCrossTab = Boolean(meta?.isCrossTab);

  // 全局字段字典映射 (优先合并 result.meta.rawHeaders、config.headers、propHeaders)
  const rawHeaders = React.useMemo<Record<string, string>>(() => {
    return {
      ...(config?.headers || {}),
      ...(meta?.rawHeaders || {}),
      ...(propHeaders || {}),
    };
  }, [config?.headers, meta?.rawHeaders, propHeaders]);

  // 解析字段友好显示名称 (支持 showFieldKeys 模式)
  const getFieldLabel = React.useCallback(
    (fieldKey: string): string => {
      const label = rawHeaders[fieldKey] || config?.headers?.[fieldKey] || fieldKey;
      if (showFieldKeys && label !== fieldKey) {
        return `${label} (${fieldKey})`;
      }
      return label;
    },
    [rawHeaders, config?.headers, showFieldKeys]
  );

  // =========================================================================
  // 提取 2D 交叉透视矩阵结构
  // =========================================================================
  const pivotData = React.useMemo(() => {
    if (!isCrossTab || data.length === 0) return null;

    const rowDimFields: string[] = [
      ...(config?.dimensions?.timeBucket?.field ? [config.dimensions.timeBucket.field] : []),
      ...(config?.dimensions?.categories ?? []),
    ];

    const colDimFields: string[] = [
      ...(config?.dimensions?.columnTimeBucket?.field ? [config.dimensions.columnTimeBucket.field] : []),
      ...(config?.dimensions?.columnCategories ?? []),
    ];

    if (colDimFields.length === 0) return null;

    const metrics: OutputColumnMeta[] = columnsMeta.filter(
      (col) => !rowDimFields.includes(col.field || col.key) && !colDimFields.includes(col.field || col.key)
    );

    if (metrics.length === 0) return null;

    const rowTuples: DimTuple[] = [];
    const rowKeySet = new Set<string>();
    const colTuples: DimTuple[] = [];
    const colKeySet = new Set<string>();
    const cellMap = new Map<string, DataRecord>();

    for (const r of data) {
      const rKey = rowDimFields.map((f) => String(r[f] ?? '')).join('__');
      if (!rowKeySet.has(rKey)) {
        rowKeySet.add(rKey);
        const rVals: Record<string, unknown> = {};
        for (const f of rowDimFields) rVals[f] = r[f];
        rowTuples.push({
          key: rKey,
          label: rowDimFields.map((f) => String(r[f] ?? '')).join(' / ') || '-',
          values: rVals,
        });
      }

      const cKey = colDimFields.map((f) => String(r[f] ?? '')).join('__');
      if (!colKeySet.has(cKey)) {
        colKeySet.add(cKey);
        const cVals: Record<string, unknown> = {};
        for (const f of colDimFields) cVals[f] = r[f];
        colTuples.push({
          key: cKey,
          label: colDimFields.map((f) => String(r[f] ?? '')).join(' / ') || '-',
          values: cVals,
        });
      }

      cellMap.set(`${rKey}____${cKey}`, r);
    }

    const indicatorsAsCol = config?.dimensions?.indicatorsAsCol !== false;
    const showRowTotals = config?.dimensions?.rowTotals?.showGrandTotals !== false;
    const rowTotalsLabel = config?.dimensions?.rowTotals?.grandTotalLabel || t('行总计');
    const showColTotals = config?.dimensions?.columnTotals?.showGrandTotals !== false;
    const colTotalsLabel = config?.dimensions?.columnTotals?.grandTotalLabel || t('列总计');

    // 智能计算汇总：遵循统计口径 (SUM求和、AVG求均值、MIN最小值、MAX最大值、COUNT计数、以及 COMPUTED 动态公式重算)
    const rowMetricSums = new Map<string, number>();
    const colMetricSums = new Map<string, number>();
    const grandMetricSums = new Map<string, number>();

    const baseMetrics = metrics.filter((m) => m.kind !== 'computed' && !m.expression);
    const computedMetrics = metrics.filter((m) => m.kind === 'computed' || m.expression);

    // 1. 各列维度按行汇总（列总计，即底部的“车间总计”行）
    for (const c of colTuples) {
      const colContext: Record<string, unknown> = {};

      for (const m of baseMetrics) {
        const vals: number[] = [];
        for (const r of rowTuples) {
          const rec = cellMap.get(`${r.key}____${c.key}`);
          if (!rec) continue;
          const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
          if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
            vals.push(rawVal);
          }
        }
        const aggType = getColumnAggType(m, config);
        const colVal = aggregateValues(vals, aggType, m.precision);
        colMetricSums.set(`${c.key}___${m.key}`, colVal);
        colContext[m.key] = colVal;
        colContext[m.title] = colVal;
        if (m.field) {
          colContext[m.field] = colVal;
          colContext[`SUM(${m.field})`] = colVal;
          colContext[`sum(${m.field})`] = colVal;
          colContext[`AVG(${m.field})`] = colVal;
          colContext[`avg(${m.field})`] = colVal;
        }
      }

      for (const m of computedMetrics) {
        let computedVal: number | undefined;
        if (m.expression) {
          try {
            const evalRes = evaluateFormula(m.expression, colContext, { nullAsZero: true });
            if (typeof evalRes === 'number' && Number.isFinite(evalRes)) {
              computedVal = roundTo(evalRes, m.precision !== undefined ? m.precision : 2);
            }
          } catch {
            // formula evaluation failed
          }
        }
        if (computedVal === undefined) {
          const vals: number[] = [];
          for (const r of rowTuples) {
            const rec = cellMap.get(`${r.key}____${c.key}`);
            if (!rec) continue;
            const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
            if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
              vals.push(rawVal);
            }
          }
          const isRatio = m.key.includes('ratio') || m.key.includes('rate') || m.title.includes('%') || m.title.includes('率');
          computedVal = aggregateValues(vals, isRatio ? 'avg' : 'sum', m.precision);
        }
        colMetricSums.set(`${c.key}___${m.key}`, computedVal);
        colContext[m.key] = computedVal;
        colContext[m.title] = computedVal;
      }
    }

    // 2. 各行维度跨列汇总（行总计，即右侧的“全期总计”列）
    for (const r of rowTuples) {
      const rowContext: Record<string, unknown> = {};

      for (const m of baseMetrics) {
        const vals: number[] = [];
        for (const c of colTuples) {
          const rec = cellMap.get(`${r.key}____${c.key}`);
          if (!rec) continue;
          const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
          if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
            vals.push(rawVal);
          }
        }
        const aggType = getColumnAggType(m, config);
        const rowVal = aggregateValues(vals, aggType, m.precision);
        rowMetricSums.set(`${r.key}___${m.key}`, rowVal);
        rowContext[m.key] = rowVal;
        rowContext[m.title] = rowVal;
        if (m.field) {
          rowContext[m.field] = rowVal;
          rowContext[`SUM(${m.field})`] = rowVal;
          rowContext[`sum(${m.field})`] = rowVal;
          rowContext[`AVG(${m.field})`] = rowVal;
          rowContext[`avg(${m.field})`] = rowVal;
        }
      }

      for (const m of computedMetrics) {
        let computedVal: number | undefined;
        if (m.expression) {
          try {
            const evalRes = evaluateFormula(m.expression, rowContext, { nullAsZero: true });
            if (typeof evalRes === 'number' && Number.isFinite(evalRes)) {
              computedVal = roundTo(evalRes, m.precision !== undefined ? m.precision : 2);
            }
          } catch {
            // fallback
          }
        }
        if (computedVal === undefined) {
          const vals: number[] = [];
          for (const c of colTuples) {
            const rec = cellMap.get(`${r.key}____${c.key}`);
            if (!rec) continue;
            const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
            if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
              vals.push(rawVal);
            }
          }
          const isRatio = m.key.includes('ratio') || m.key.includes('rate') || m.title.includes('%') || m.title.includes('率');
          computedVal = aggregateValues(vals, isRatio ? 'avg' : 'sum', m.precision);
        }
        rowMetricSums.set(`${r.key}___${m.key}`, computedVal);
        rowContext[m.key] = computedVal;
        rowContext[m.title] = computedVal;
      }
    }

    // 3. 全局总计（右下角交叉汇总单元格）
    const grandContext: Record<string, unknown> = {};

    for (const m of baseMetrics) {
      const vals: number[] = [];
      for (const r of rowTuples) {
        for (const c of colTuples) {
          const rec = cellMap.get(`${r.key}____${c.key}`);
          if (!rec) continue;
          const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
          if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
            vals.push(rawVal);
          }
        }
      }
      const aggType = getColumnAggType(m, config);
      const grandVal = aggregateValues(vals, aggType, m.precision);
      grandMetricSums.set(m.key, grandVal);
      grandContext[m.key] = grandVal;
      grandContext[m.title] = grandVal;
      if (m.field) {
        grandContext[m.field] = grandVal;
        grandContext[`SUM(${m.field})`] = grandVal;
        grandContext[`sum(${m.field})`] = grandVal;
        grandContext[`AVG(${m.field})`] = grandVal;
        grandContext[`avg(${m.field})`] = grandVal;
      }
    }

    for (const m of computedMetrics) {
      let computedVal: number | undefined;
      if (m.expression) {
        try {
          const evalRes = evaluateFormula(m.expression, grandContext, { nullAsZero: true });
          if (typeof evalRes === 'number' && Number.isFinite(evalRes)) {
            computedVal = roundTo(evalRes, m.precision !== undefined ? m.precision : 2);
          }
        } catch {
          // fallback
        }
      }
      if (computedVal === undefined) {
        const vals: number[] = [];
        for (const r of rowTuples) {
          for (const c of colTuples) {
            const rec = cellMap.get(`${r.key}____${c.key}`);
            if (!rec) continue;
            const rawVal = rec[m.key] ?? rec[m.title] ?? (m.field ? rec[m.field] : undefined);
            if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
              vals.push(rawVal);
            }
          }
        }
        const isRatio = m.key.includes('ratio') || m.key.includes('rate') || m.title.includes('%') || m.title.includes('率');
        computedVal = aggregateValues(vals, isRatio ? 'avg' : 'sum', m.precision);
      }
      grandMetricSums.set(m.key, computedVal);
    }

    return {
      rowDimFields,
      colDimFields,
      metrics,
      rowTuples,
      colTuples,
      cellMap,
      indicatorsAsCol,
      showRowTotals,
      rowTotalsLabel,
      showColTotals,
      colTotalsLabel,
      rowMetricSums,
      colMetricSums,
      grandMetricSums,
    };
  }, [isCrossTab, data, config, columnsMeta, t]);

  // =========================================================================
  // 1D 扁平明细或常规聚合表视图 总计行计算 (同 VTableView 一致采用 computeSummaryValues)
  // =========================================================================
  const summary1D = React.useMemo(() => {
    if (isCrossTab || data.length === 0) return null;
    const showRowTotals = config?.dimensions?.rowTotals?.showGrandTotals !== false;
    if (!showRowTotals) return null;
    return computeSummaryValues(data, columnsMeta, meta?.rawHeaders);
  }, [isCrossTab, data, columnsMeta, meta?.rawHeaders, config?.dimensions?.rowTotals?.showGrandTotals]);

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <TableOutlined style={{ color: '#1677ff', fontSize: 15 }} />
          <span style={{ fontWeight: 600 }}>{t('转换结果实时预览 (前 10 行)')}</span>
          <Badge status="processing" text={<span style={{ fontSize: 12, color: '#52c41a' }}>{t('实时响应')}</span>} />
        </Space>
      }
      extra={
        meta && (
          <Space size={10} wrap>
            {meta.form === 'detail' && <Tag color="green">{t('全量明细表')}</Tag>}
            {meta.form === 'pivot' && (
              <Tag color={meta.isCrossTab ? 'purple' : 'blue'}>
                {meta.isCrossTab ? t('双向交叉透视表') : t('分组透视表')}
              </Tag>
            )}
            {meta.form === 'summary' && <Tag color="purple">{t('全局汇总卡片')}</Tag>}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('原数据: {input} 行 | 转换输出: {output} 行', {
                input: meta.inputRows,
                output: meta.outputRows,
              })}
            </Text>
            <Tag color="cyan" icon={<ThunderboltOutlined />}>
              {t('计算耗时: {time} ms', { time: meta.executionTimeMs })}
            </Tag>
          </Space>
        )
      }
      style={{ marginBottom: 10, borderRadius: 8, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ overflowX: 'auto', width: '100%', minHeight: 120 }}>
        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#8c8c8c' }}>
            {t('计算中...')}
          </div>
        ) : data.length === 0 || columnsMeta.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#8c8c8c', fontSize: 13 }}>
            {t('配置完成后将在此实时预览转换效果')}
          </div>
        ) : isCrossTab && pivotData ? (
          /* ===============================================================
             2D 交叉透视网格视图 (Cross-Tab Pivot Grid)
             =============================================================== */
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              textAlign: 'left',
            }}
          >
            {pivotData.indicatorsAsCol ? (
              /* 指标按列横向排布 (默认) */
              <>
                <thead>
                  {/* 第一行：行维度 + 各列维度分组 + 列总计 */}
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                    {pivotData.rowDimFields.map((f) => (
                      <th
                        key={f}
                        rowSpan={2}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #d9d9d9',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'middle',
                          backgroundColor: '#f5f7fa',
                        }}
                      >
                        <Space size={4}>
                          <span>{getFieldLabel(f)}</span>
                          <Tag color="default" style={{ fontSize: 10, margin: 0, padding: '0 3px' }}>
                            {t('行')}
                          </Tag>
                        </Space>
                      </th>
                    ))}
                    {pivotData.colTuples.map((c) => (
                      <th
                        key={c.key}
                        colSpan={pivotData.metrics.length}
                        style={{
                          padding: '6px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #e8e8e8',
                          backgroundColor: '#f0f5ff',
                          color: '#1d39c4',
                          whiteSpace: 'nowrap',
                        }}
                        title={pivotData.colDimFields.map((field) => getFieldLabel(field)).join(' / ')}
                      >
                        {c.label}
                      </th>
                    ))}
                    {pivotData.showColTotals && (
                      <th
                        colSpan={pivotData.metrics.length}
                        style={{
                          padding: '6px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          borderBottom: '1px solid #e8e8e8',
                          backgroundColor: '#e6f4ff',
                          color: '#0958d9',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pivotData.colTotalsLabel}
                      </th>
                    )}
                  </tr>
                  {/* 第二行：平铺在各列维度下方的指标 */}
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #d9d9d9' }}>
                    {pivotData.colTuples.map((c) =>
                      pivotData.metrics.map((m) => (
                        <th
                          key={`${c.key}_${m.key}`}
                          style={{
                            padding: '6px 8px',
                            fontWeight: 500,
                            textAlign: 'right',
                            fontSize: 11,
                            borderRight: '1px solid #f0f0f0',
                            borderBottom: '1px solid #d9d9d9',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </th>
                      ))
                    )}
                    {pivotData.showColTotals &&
                      pivotData.metrics.map((m) => (
                        <th
                          key={`col_total_${m.key}`}
                          style={{
                            padding: '6px 8px',
                            fontWeight: 600,
                            textAlign: 'right',
                            fontSize: 11,
                            borderRight: '1px solid #e8e8e8',
                            borderBottom: '1px solid #d9d9d9',
                            backgroundColor: '#f6faff',
                            color: '#0958d9',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.rowTuples.slice(0, 10).map((r, rIdx) => (
                    <tr
                      key={r.key}
                      style={{
                        backgroundColor: rIdx % 2 === 1 ? '#fafcff' : '#ffffff',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      {pivotData.rowDimFields.map((f) => (
                        <td
                          key={f}
                          style={{
                            padding: '6px 10px',
                            fontWeight: 500,
                            borderRight: '1px solid #f0f0f0',
                            whiteSpace: 'nowrap',
                            color: 'rgba(0, 0, 0, 0.88)',
                          }}
                        >
                          {String(r.values[f] ?? '-')}
                        </td>
                      ))}
                      {pivotData.colTuples.map((c) =>
                        pivotData.metrics.map((m) => {
                          const rec = pivotData.cellMap.get(`${r.key}____${c.key}`);
                          const val = rec ? (rec[m.key] ?? rec[m.title]) : undefined;
                          return (
                            <td
                              key={`${c.key}_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                whiteSpace: 'nowrap',
                                color: val === undefined ? '#bfbfbf' : 'rgba(0, 0, 0, 0.85)',
                              }}
                            >
                              {formatValue(val, m.precision)}
                            </td>
                          );
                        })
                      )}
                      {pivotData.showColTotals &&
                        pivotData.metrics.map((m) => {
                          const rowSum = pivotData.rowMetricSums.get(`${r.key}___${m.key}`);
                          return (
                            <td
                              key={`total_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #e8e8e8',
                                backgroundColor: '#f9fcff',
                                fontWeight: 600,
                                color: '#0958d9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {formatValue(rowSum, m.precision)}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                  {/* 行总计 */}
                  {pivotData.showRowTotals && (
                    <tr
                      style={{
                        backgroundColor: '#fafafa',
                        borderTop: '2px solid #d9d9d9',
                        fontWeight: 600,
                      }}
                    >
                      <td
                        colSpan={pivotData.rowDimFields.length}
                        style={{
                          padding: '7px 10px',
                          borderRight: '1px solid #e8e8e8',
                          color: 'rgba(0, 0, 0, 0.88)',
                        }}
                      >
                        {pivotData.rowTotalsLabel}
                      </td>
                      {pivotData.colTuples.map((c) =>
                        pivotData.metrics.map((m) => {
                          const colSum = pivotData.colMetricSums.get(`${c.key}___${m.key}`);
                          return (
                            <td
                              key={`rsum_${c.key}_${m.key}`}
                              style={{
                                padding: '7px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                color: '#262626',
                              }}
                            >
                              {formatValue(colSum, m.precision)}
                            </td>
                          );
                        })
                      )}
                      {pivotData.showColTotals &&
                        pivotData.metrics.map((m) => {
                          const grandSum = pivotData.grandMetricSums.get(m.key);
                          return (
                            <td
                              key={`grand_${m.key}`}
                              style={{
                                padding: '7px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #e8e8e8',
                                backgroundColor: '#e6f4ff',
                                color: '#0958d9',
                                fontWeight: 'bold',
                              }}
                            >
                              {formatValue(grandSum, m.precision)}
                            </td>
                          );
                        })}
                    </tr>
                  )}
                </tbody>
              </>
            ) : (
              /* 指标按行纵向排布 */
              <>
                <thead>
                  <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #d9d9d9' }}>
                    {pivotData.rowDimFields.map((f) => (
                      <th
                        key={f}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          borderRight: '1px solid #e8e8e8',
                          whiteSpace: 'nowrap',
                          backgroundColor: '#f5f7fa',
                        }}
                      >
                        {getFieldLabel(f)}
                      </th>
                    ))}
                    <th
                      style={{
                        padding: '8px 10px',
                        fontWeight: 600,
                        borderRight: '1px solid #e8e8e8',
                        whiteSpace: 'nowrap',
                        backgroundColor: '#f5f7fa',
                      }}
                    >
                      {t('度量指标')}
                    </th>
                    {pivotData.colTuples.map((c) => (
                      <th
                        key={c.key}
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          backgroundColor: '#f0f5ff',
                          color: '#1d39c4',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                    {pivotData.showColTotals && (
                      <th
                        style={{
                          padding: '8px 10px',
                          fontWeight: 600,
                          textAlign: 'center',
                          borderRight: '1px solid #e8e8e8',
                          backgroundColor: '#e6f4ff',
                          color: '#0958d9',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pivotData.colTotalsLabel}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.rowTuples.slice(0, 10).map((r, rIdx) =>
                    pivotData.metrics.map((m, mIdx) => (
                      <tr
                        key={`${r.key}_${m.key}`}
                        style={{
                          backgroundColor: rIdx % 2 === 1 ? '#fafcff' : '#ffffff',
                          borderBottom:
                            mIdx === pivotData.metrics.length - 1
                              ? '1px solid #d9d9d9'
                              : '1px solid #f0f0f0',
                        }}
                      >
                        {mIdx === 0 &&
                          pivotData.rowDimFields.map((f) => (
                            <td
                              key={f}
                              rowSpan={pivotData.metrics.length}
                              style={{
                                padding: '6px 10px',
                                fontWeight: 500,
                                borderRight: '1px solid #e8e8e8',
                                verticalAlign: 'top',
                                whiteSpace: 'nowrap',
                                color: 'rgba(0, 0, 0, 0.88)',
                              }}
                            >
                              {String(r.values[f] ?? '-')}
                            </td>
                          ))}
                        <td
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid #f0f0f0',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </td>
                        {pivotData.colTuples.map((c) => {
                          const rec = pivotData.cellMap.get(`${r.key}____${c.key}`);
                          const val = rec ? (rec[m.key] ?? rec[m.title]) : undefined;
                          return (
                            <td
                              key={`${c.key}_${m.key}`}
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                borderRight: '1px solid #f0f0f0',
                                whiteSpace: 'nowrap',
                                color: val === undefined ? '#bfbfbf' : 'rgba(0, 0, 0, 0.85)',
                              }}
                            >
                              {formatValue(val, m.precision)}
                            </td>
                          );
                        })}
                        {pivotData.showColTotals && (
                          <td
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #e8e8e8',
                              backgroundColor: '#f9fcff',
                              fontWeight: 600,
                              color: '#0958d9',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatValue(pivotData.rowMetricSums.get(`${r.key}___${m.key}`), m.precision)}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                  {/* 行总计 */}
                  {pivotData.showRowTotals &&
                    pivotData.metrics.map((m, mIdx) => (
                      <tr
                        key={`total_row_${m.key}`}
                        style={{
                          backgroundColor: '#fafafa',
                          borderTop: mIdx === 0 ? '2px solid #d9d9d9' : 'none',
                          borderBottom:
                            mIdx === pivotData.metrics.length - 1
                              ? '1px solid #d9d9d9'
                              : '1px solid #f0f0f0',
                          fontWeight: 600,
                        }}
                      >
                        {mIdx === 0 && (
                          <td
                            rowSpan={pivotData.metrics.length}
                            colSpan={pivotData.rowDimFields.length}
                            style={{
                              padding: '7px 10px',
                              borderRight: '1px solid #e8e8e8',
                              verticalAlign: 'top',
                              color: 'rgba(0, 0, 0, 0.88)',
                            }}
                          >
                            {pivotData.rowTotalsLabel}
                          </td>
                        )}
                        <td
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid #f0f0f0',
                            color: '#595959',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.title}
                        </td>
                        {pivotData.colTuples.map((c) => (
                          <td
                            key={`col_sum_${c.key}_${m.key}`}
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #f0f0f0',
                              color: '#262626',
                            }}
                          >
                            {formatValue(pivotData.colMetricSums.get(`${c.key}___${m.key}`), m.precision)}
                          </td>
                        ))}
                        {pivotData.showColTotals && (
                          <td
                            style={{
                              padding: '6px 8px',
                              textAlign: 'right',
                              borderRight: '1px solid #e8e8e8',
                              backgroundColor: '#e6f4ff',
                              color: '#0958d9',
                              fontWeight: 'bold',
                            }}
                          >
                            {formatValue(pivotData.grandMetricSums.get(m.key), m.precision)}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </>
            )}
          </table>
        ) : (
          /* ===============================================================
             1D 扁平明细或常规聚合表视图 (Flat Table)
             =============================================================== */
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                }}
              >
                {columnsMeta.map((col) => (
                  <th
                    key={col.key}
                    style={{
                      padding: '8px 12px',
                      fontWeight: 600,
                      textAlign: col.type === 'number' ? 'right' : 'left',
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <Space size={4}>
                      <span>{col.title}</span>
                      {col.type === 'number' && (
                        <Tag color="green" style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>
                          123
                        </Tag>
                      )}
                      {col.type === 'time' && (
                        <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>
                          {t('时间')}
                        </Tag>
                      )}
                    </Space>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    backgroundColor: idx % 2 === 1 ? '#fafcff' : '#ffffff',
                  }}
                >
                  {columnsMeta.map((col) => {
                    const val = row[col.key];
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: '7px 12px',
                          textAlign: col.type === 'number' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          color: 'rgba(0, 0, 0, 0.85)',
                        }}
                      >
                        {formatValue(val, col.precision)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {summary1D && (
              <tfoot>
                <tr
                  style={{
                    backgroundColor: '#fafafa',
                    borderTop: '2px solid #d9d9d9',
                    fontWeight: 600,
                  }}
                >
                  {columnsMeta.map((col, idx) => {
                    const isFirst = idx === 0;
                    if (isFirst) {
                      const totalLabel =
                        config?.dimensions?.rowTotals?.grandTotalLabel ||
                        t('总计 (共 {count} 项)', { count: data.length });
                      return (
                        <td
                          key={col.key}
                          style={{
                            padding: '7px 12px',
                            textAlign: 'left',
                            whiteSpace: 'nowrap',
                            color: 'rgba(0, 0, 0, 0.88)',
                            borderRight: '1px solid #f0f0f0',
                          }}
                        >
                          {totalLabel}
                        </td>
                      );
                    }
                    const val = summary1D[col.key];
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: '7px 12px',
                          textAlign: col.type === 'number' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          color: '#0958d9',
                          borderRight: '1px solid #f0f0f0',
                        }}
                      >
                        {formatValue(val, col.precision)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </Card>
  );
};
